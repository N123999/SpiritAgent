import { spawn } from 'node:child_process';
import path from 'node:path';
import { rgPath } from '@vscode/ripgrep';

const MAX_SEARCH_FILE_SIZE = '1M';

/** 任意路径下的 .git 目录均不参与搜索（含 --hidden 全文模式） */
const RIPGREP_EXCLUDED_GLOBS = ['!**/.git/**'] as const;

export type RipgrepSearchOptions = {
  workspaceRoot: string;
  query: string;
  isRegexp?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  globPattern?: string | null;
};

export type RipgrepSubmatch = {
  start: number;
  end: number;
};

export type RipgrepMatch = {
  relativePath: string;
  lineNumber: number;
  lineText: string;
  submatches: RipgrepSubmatch[];
};

type RipgrepMatchLine = {
  path: { text: string };
  lines: { text?: string; bytes?: string };
  line_number: number;
  submatches?: Array<{ start: number; end: number }>;
};

type RipgrepJsonLine =
  | {
      type: 'match';
      data: RipgrepMatchLine;
    }
  | {
      type: string;
      data?: unknown;
    };

/** 去掉 rg JSON 行尾换行；保留行首缩进，submatch 字节偏移与 lineText 对齐。 */
export function normalizeSearchLine(line: string): string {
  return line.replace(/\r?\n$/u, '');
}

function readRipgrepMatchLineText(lines: RipgrepMatchLine['lines']): string | undefined {
  if (typeof lines.text === 'string') {
    return lines.text;
  }
  // 二进制命中仅有 lines.bytes；工作区文本搜索跳过
  return undefined;
}

function appendQueryArgs(args: string[], options: RipgrepSearchOptions): void {
  const { query, isRegexp = false, caseSensitive = false, wholeWord = false } = options;

  if (wholeWord) {
    args.push('-w');
  }

  if (isRegexp) {
    if (!caseSensitive) {
      args.push('-i');
    }
    args.push('--regexp', query);
    return;
  }

  args.push('-F');
  if (!caseSensitive) {
    args.push('-i');
  }

  if (query.startsWith('-')) {
    args.push('--', query);
  } else {
    args.push(query);
  }
}

export function buildRipgrepArgs(options: RipgrepSearchOptions): string[] {
  const { globPattern, workspaceRoot } = options;
  const args: string[] = [
    '--json',
    '--no-heading',
    '--color=never',
    '--line-number',
    '--max-filesize',
    MAX_SEARCH_FILE_SIZE,
  ];

  for (const excludedGlob of RIPGREP_EXCLUDED_GLOBS) {
    args.push('-g', excludedGlob);
  }

  if (globPattern === null || globPattern === undefined) {
    args.push('--hidden');
  }

  if (globPattern !== null && globPattern !== undefined) {
    args.push('-g', globPattern);
  }

  appendQueryArgs(args, options);
  args.push(workspaceRoot);
  return args;
}

function toRelativePath(workspaceRoot: string, filePath: string): string {
  const rel = path.relative(workspaceRoot, filePath).replace(/\\/gu, '/');
  return rel || '.';
}

function mapRipgrepRegexError(stderr: string): Error {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return new Error('无效正则');
  }
  const message = trimmed.split(/\r?\n/u).find((line) => line.trim().length > 0) ?? trimmed;
  return new Error(`无效正则: ${message}`);
}

function waitForChildClose(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', (error: Error) => {
      reject(error);
    });
    child.once('close', (code) => {
      resolve(code);
    });
  });
}

export async function runRipgrepSearch(options: RipgrepSearchOptions): Promise<RipgrepMatch[]> {
  const args = buildRipgrepArgs(options);
  const child = spawn(rgPath, args, {
    cwd: options.workspaceRoot,
    windowsHide: true,
  });

  const matches: RipgrepMatch[] = [];
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const exitCode = await waitForChildClose(child);

  if (exitCode === 2) {
    if (options.isRegexp) {
      throw mapRipgrepRegexError(stderr);
    }
    throw new Error(stderr.trim() || `ripgrep failed with exit code ${exitCode}`);
  }

  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(stderr.trim() || `ripgrep failed with exit code ${exitCode}`);
  }

  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }

    let parsed: RipgrepJsonLine;
    try {
      parsed = JSON.parse(line) as RipgrepJsonLine;
    } catch {
      continue;
    }

    if (parsed.type !== 'match') {
      continue;
    }

    const matchData = (parsed as { type: 'match'; data: RipgrepMatchLine }).data;
    const rawLineText = readRipgrepMatchLineText(matchData.lines);
    if (rawLineText === undefined || !matchData.path?.text) {
      continue;
    }
    matches.push({
      relativePath: toRelativePath(options.workspaceRoot, matchData.path.text),
      lineNumber: matchData.line_number,
      lineText: normalizeSearchLine(rawLineText),
      submatches: (matchData.submatches ?? []).map((item) => ({
        start: item.start,
        end: item.end,
      })),
    });
  }

  return matches;
}

export function formatGrepToolOutput(params: {
  query: string;
  isRegexp: boolean;
  globPattern: string | null;
  matches: RipgrepMatch[];
}): string {
  const { query, isRegexp, globPattern, matches } = params;
  const searchMode = isRegexp ? '正则' : '文本';
  const files = new Set<string>();

  for (const match of matches) {
    files.add(match.relativePath);
  }

  if (files.size === 0) {
    let out = `[tool] 搜索(${searchMode}): ${query}`;
    if (globPattern !== null) {
      out += `\nglob: ${globPattern}`;
    }
    out += '\n未搜索到文件';
    return out;
  }

  let out = `[tool] 搜索(${searchMode}): ${query}`;
  if (globPattern !== null) {
    out += `\nglob: ${globPattern}`;
  }
  out += '\n命中片段\n';
  for (const match of matches) {
    out += `${match.relativePath}:${match.lineNumber} | ${match.lineText}\n`;
  }
  out += '\n涉及文件\n';
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    out += `${file}\n`;
  }
  return out;
}
