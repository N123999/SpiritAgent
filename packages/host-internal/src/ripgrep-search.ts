import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { rgPath } from '@vscode/ripgrep';

const MAX_SEARCH_FILE_SIZE = '1M';

export type RipgrepSearchOptions = {
  workspaceRoot: string;
  query: string;
  isRegexp?: boolean;
  globPattern?: string | null;
};

export type RipgrepMatch = {
  relativePath: string;
  lineNumber: number;
  lineText: string;
};

type RipgrepMatchLine = {
  path: { text: string };
  lines: { text: string };
  line_number: number;
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

export function normalizeSearchLine(line: string): string {
  return line.replace(/\r?\n$/u, '').trim();
}

export function buildRipgrepArgs(options: RipgrepSearchOptions): string[] {
  const { query, isRegexp = false, globPattern, workspaceRoot } = options;
  const args: string[] = [
    '--json',
    '--no-heading',
    '--color=never',
    '--line-number',
    '--max-filesize',
    MAX_SEARCH_FILE_SIZE,
  ];

  if (globPattern === null || globPattern === undefined) {
    args.push('--hidden');
  }

  if (globPattern !== null && globPattern !== undefined) {
    args.push('-g', globPattern);
  }

  if (isRegexp) {
    args.push('-i', '--regexp', query);
  } else if (query.startsWith('-')) {
    args.push('-F', '-i', '--', query);
  } else {
    args.push('-F', '-i', query);
  }

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

  const [exitCode] = await once(child, 'close');

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
    matches.push({
      relativePath: toRelativePath(options.workspaceRoot, matchData.path.text),
      lineNumber: matchData.line_number,
      lineText: normalizeSearchLine(matchData.lines.text),
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
