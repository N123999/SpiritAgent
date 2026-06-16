import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import ignore, { type Ignore } from 'ignore';

const createIgnore = ignore as unknown as (options?: {
  allowRelativePaths?: boolean;
}) => Ignore;

const IGNORE_FILE_NAMES = ['.gitignore', '.ignore'] as const;

export interface WorkspaceExplorerIgnoreEntry {
  name: string;
  kind: 'file' | 'dir';
}

interface IgnoreMatcherEntry {
  baseRelPath: string;
  matcher: Ignore;
}

const ignoreMatcherCache = new Map<string, IgnoreMatcherEntry[]>();

function ignoreMatcherCacheKey(workspaceRoot: string, dirRelPath: string): string {
  return `${workspaceRoot}\0${dirRelPath}`;
}

function joinWorkspaceRelativePath(parentRelPath: string, name: string): string {
  const normalizedParent = parentRelPath.replace(/\\/gu, '/').trim();
  if (!normalizedParent) {
    return name;
  }
  return `${normalizedParent}/${name}`;
}

function explorerEntryGitCheckIgnorePath(
  parentRelPath: string,
  entry: WorkspaceExplorerIgnoreEntry,
): string {
  const relativePath = joinWorkspaceRelativePath(parentRelPath, entry.name);
  return entry.kind === 'dir' ? `${relativePath}/` : relativePath;
}

export interface ResolveWorkspaceExplorerIgnoreFlagsOptions {
  /** Explorer 热路径：优先走内存 ignore 匹配，避免每次 spawn git check-ignore。 */
  preferInProcess?: boolean;
}

export async function resolveWorkspaceExplorerIgnoreFlags(
  workspaceRoot: string,
  parentRelPath: string,
  entries: readonly WorkspaceExplorerIgnoreEntry[],
  options?: ResolveWorkspaceExplorerIgnoreFlagsOptions,
): Promise<boolean[]> {
  if (entries.length === 0) {
    return [];
  }

  if (options?.preferInProcess === true) {
    try {
      return await resolveViaIgnoreLibrary(workspaceRoot, parentRelPath, entries);
    } catch {
      // 非阻塞：内存匹配失败时回退 git。
    }
    try {
      const viaGit = await resolveViaGitCheckIgnore(workspaceRoot, parentRelPath, entries);
      if (viaGit !== null) {
        return viaGit;
      }
    } catch {
      // 非阻塞
    }
    return entries.map(() => false);
  }

  try {
    const viaGit = await resolveViaGitCheckIgnore(workspaceRoot, parentRelPath, entries);
    if (viaGit !== null) {
      return viaGit;
    }
  } catch {
    // 非阻塞：Git 判定失败时走 ignore 库 fallback。
  }

  try {
    return await resolveViaIgnoreLibrary(workspaceRoot, parentRelPath, entries);
  } catch {
    return entries.map(() => false);
  }
}

async function resolveViaGitCheckIgnore(
  workspaceRoot: string,
  parentRelPath: string,
  entries: readonly WorkspaceExplorerIgnoreEntry[],
): Promise<boolean[] | null> {
  try {
    await stat(resolve(workspaceRoot, '.git'));
  } catch {
    return null;
  }

  const paths = entries.map((entry) => explorerEntryGitCheckIgnorePath(parentRelPath, entry));
  const stdin = `${paths.join('\0')}\0`;

  let stdout: string;
  try {
    stdout = await runGitCheckIgnoreStdin(workspaceRoot, stdin);
  } catch {
    return null;
  }

  const ignoredPaths = new Set(
    stdout
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/\\/gu, '/')),
  );

  return paths.map((path) => ignoredPaths.has(path));
}

function runGitCheckIgnoreStdin(workspaceRoot: string, stdin: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['check-ignore', '-z', '--stdin'], {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git check-ignore exited with code ${String(code)}`));
    });

    child.stdin.write(stdin);
    child.stdin.end();
  });
}

async function resolveViaIgnoreLibrary(
  workspaceRoot: string,
  parentRelPath: string,
  entries: readonly WorkspaceExplorerIgnoreEntry[],
): Promise<boolean[]> {
  const flags: boolean[] = [];
  for (const entry of entries) {
    const relativePath = joinWorkspaceRelativePath(parentRelPath, entry.name);
    const parentDirRelPath = parentRelPath.replace(/\\/gu, '/').trim();
    const matchers = await cachedIgnoreMatchersForRelativeDir(workspaceRoot, parentDirRelPath);
    flags.push(shouldIgnoreWorkspacePath(relativePath, entry.kind === 'dir', matchers));
  }
  return flags;
}

export async function cachedIgnoreMatchersForRelativeDir(
  workspaceRoot: string,
  dirRelPath: string,
  cache?: Map<string, IgnoreMatcherEntry[]>,
): Promise<IgnoreMatcherEntry[]> {
  const normalizedDirRelPath = dirRelPath.replace(/\\/gu, '/').trim();
  const cacheKey = cache ? normalizedDirRelPath : ignoreMatcherCacheKey(workspaceRoot, normalizedDirRelPath);

  const targetCache = cache ?? ignoreMatcherCache;
  const cached = targetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const segments = normalizedDirRelPath
    ? normalizedDirRelPath.split('/').filter((segment) => segment.length > 0)
    : [];
  let matchers: IgnoreMatcherEntry[] = [];
  let currentRelPath = '';

  for (let index = 0; index <= segments.length; index += 1) {
    matchers = [...matchers, ...(await readIgnoreMatchers(workspaceRoot, currentRelPath))];
    if (index < segments.length) {
      currentRelPath = currentRelPath
        ? `${currentRelPath}/${segments[index]}`
        : segments[index]!;
    }
  }

  targetCache.set(cacheKey, matchers);
  return matchers;
}

async function readIgnoreMatchers(
  workspaceRoot: string,
  currentDirRelPath: string,
): Promise<IgnoreMatcherEntry[]> {
  const matchers: IgnoreMatcherEntry[] = [];

  for (const ignoreFileName of IGNORE_FILE_NAMES) {
    const ignoreFileAbsolutePath = currentDirRelPath
      ? resolve(workspaceRoot, ...currentDirRelPath.split('/'), ignoreFileName)
      : resolve(workspaceRoot, ignoreFileName);
    const matcher = await readIgnoreMatcher(ignoreFileAbsolutePath, currentDirRelPath);
    if (matcher) {
      matchers.push(matcher);
    }
  }

  if (!currentDirRelPath) {
    const excludeMatcher = await readIgnoreMatcher(
      resolve(workspaceRoot, '.git', 'info', 'exclude'),
      '',
    );
    if (excludeMatcher) {
      matchers.push(excludeMatcher);
    }
  }

  return matchers;
}

async function readIgnoreMatcher(
  absolutePath: string,
  baseRelPath: string,
): Promise<IgnoreMatcherEntry | undefined> {
  let content: string;
  try {
    content = await readFile(absolutePath, 'utf8');
  } catch {
    return undefined;
  }

  const patterns = content
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (patterns.length === 0) {
    return undefined;
  }

  return {
    baseRelPath,
    matcher: createIgnore({ allowRelativePaths: true }).add(patterns),
  };
}

export function shouldIgnoreWorkspacePath(
  relativePath: string,
  isDirectory: boolean,
  matchers: readonly IgnoreMatcherEntry[],
): boolean {
  let ignored = false;
  const pathWithDirectorySuffix = isDirectory ? `${relativePath}/` : relativePath;

  for (const entry of matchers) {
    const matcherRelativePath = relativePathFromMatcherBase(entry.baseRelPath, pathWithDirectorySuffix);
    if (!matcherRelativePath) {
      continue;
    }

    const result = entry.matcher.test(matcherRelativePath);
    if (result.ignored) {
      ignored = true;
    }
    if (result.unignored) {
      ignored = false;
    }
  }

  return ignored;
}

function relativePathFromMatcherBase(baseRelPath: string, targetRelativePath: string): string | undefined {
  if (!baseRelPath) {
    return targetRelativePath;
  }

  if (targetRelativePath === `${baseRelPath}/`) {
    return undefined;
  }

  if (!targetRelativePath.startsWith(`${baseRelPath}/`)) {
    return undefined;
  }

  return targetRelativePath.slice(baseRelPath.length + 1);
}
