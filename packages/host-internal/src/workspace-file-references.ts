import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import ignore, { type Ignore } from 'ignore';
import {
  computeWorkspaceFileReferenceSuggestions,
  currentWorkspaceFileReferenceQuery,
  referencedWorkspaceFilePathsFromInput,
  type WorkspaceFileReferenceSuggestionsResult,
} from './workspace-file-reference-query.js';
import { detectSupportedImageFile, hasSupportedImageExtension } from './image-file-support.js';

const createIgnore = ignore as unknown as (options?: {
  allowRelativePaths?: boolean;
}) => Ignore;

const DEFAULT_MAX_CONTENT_CHARS = 24_000;
const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set(['.git', 'target', 'node_modules', 'bin', 'obj']);
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore'] as const;

interface WorkspaceFileIndexCacheEntry {
  promise: Promise<string[]>;
  files?: string[];
}

const workspaceFileIndexCache = new Map<string, WorkspaceFileIndexCacheEntry>();

export interface WorkspaceFileReferenceTextAttachment {
  kind: 'text';
  path: string;
  totalChars: number;
  truncated: boolean;
  attachedAtUnixMs: number;
  content: string;
}

export interface WorkspaceFileReferenceImageAttachment {
  kind: 'image';
  path: string;
  attachedAtUnixMs: number;
}

export type WorkspaceFileReferenceAttachment =
  | WorkspaceFileReferenceTextAttachment
  | WorkspaceFileReferenceImageAttachment;

export interface ResolveWorkspaceFileReferenceAttachmentsOptions {
  maxContentChars?: number;
}

interface IgnoreMatcherEntry {
  baseRelPath: string;
  matcher: Ignore;
}

export async function listWorkspaceFileReferenceSuggestions(
  workspaceRoot: string,
  input: string,
  cursorChars: number,
): Promise<WorkspaceFileReferenceSuggestionsResult | undefined> {
  const query = currentWorkspaceFileReferenceQuery(input, cursorChars);
  if (!query) {
    return undefined;
  }

  const files = await collectWorkspaceFileReferenceIndex(workspaceRoot);
  return {
    query,
    suggestions: computeWorkspaceFileReferenceSuggestions(query.raw, files),
  };
}

export async function listCachedWorkspaceFileReferenceSuggestions(
  workspaceRoot: string,
  input: string,
  cursorChars: number,
): Promise<WorkspaceFileReferenceSuggestionsResult | undefined> {
  const query = currentWorkspaceFileReferenceQuery(input, cursorChars);
  if (!query) {
    return undefined;
  }

  const files = await cachedWorkspaceFileReferenceIndex(workspaceRoot);
  if (!files) {
    void primeWorkspaceFileReferenceIndexCache(workspaceRoot).catch(() => undefined);
    return {
      query,
      suggestions: [],
    };
  }

  return {
    query,
    suggestions: computeWorkspaceFileReferenceSuggestions(query.raw, files),
  };
}

export async function collectWorkspaceFileReferenceIndex(workspaceRoot: string): Promise<string[]> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = ensureWorkspaceFileReferenceIndexCacheEntry(root);
  return [...(await entry.promise)];
}

export async function primeWorkspaceFileReferenceIndexCache(workspaceRoot: string): Promise<void> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = ensureWorkspaceFileReferenceIndexCacheEntry(root);
  entry.promise.catch(() => undefined);
}

export async function clearWorkspaceFileReferenceIndexCache(workspaceRoot?: string): Promise<void> {
  if (!workspaceRoot) {
    workspaceFileIndexCache.clear();
    return;
  }

  const resolved = resolve(workspaceRoot);
  workspaceFileIndexCache.delete(resolved);
  try {
    workspaceFileIndexCache.delete(await realpath(resolved));
  } catch {
    // 与 canonicalWorkspaceRoot 一致：路径不存在时 resolved 就是缓存 key。
  }
}

async function cachedWorkspaceFileReferenceIndex(workspaceRoot: string): Promise<string[] | undefined> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = workspaceFileIndexCache.get(root);
  return entry?.files ? [...entry.files] : undefined;
}

function ensureWorkspaceFileReferenceIndexCacheEntry(root: string): WorkspaceFileIndexCacheEntry {
  const cached = workspaceFileIndexCache.get(root);
  if (cached) {
    return cached;
  }

  const entry: WorkspaceFileIndexCacheEntry = {
    promise: Promise.resolve([]),
  };
  const pending = collectWorkspaceFileReferenceIndexUncached(root)
    .then((files) => {
      files.sort((left, right) => left.localeCompare(right));
      entry.files = files;
      return files;
    })
    .catch((error) => {
      workspaceFileIndexCache.delete(root);
      throw error;
    });
  entry.promise = pending;
  workspaceFileIndexCache.set(root, entry);
  return entry;
}

export async function resolveWorkspaceFileReferenceAttachmentsFromInput(
  workspaceRoot: string,
  text: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment[]> {
  const attachments: WorkspaceFileReferenceAttachment[] = [];

  for (const referencePath of referencedWorkspaceFilePathsFromInput(text)) {
    try {
      attachments.push(await workspaceFileReferenceAttachmentFromPath(workspaceRoot, referencePath, options));
    } catch {
      // 与现有 agent-core / CLI 行为保持一致：忽略不存在、不可读或不支持的引用。
    }
  }

  return attachments;
}

export async function workspaceFileReferenceAttachmentFromPath(
  workspaceRoot: string,
  referencePath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const { absolutePath, relativePath } = await resolveWorkspaceFileReferencePath(workspaceRoot, referencePath);
  return localFileAttachmentFromAbsolutePath(absolutePath, relativePath, options);
}

export async function localFileAttachmentFromPath(
  absolutePath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const normalizedPath = absolutePath.replace(/\\/gu, '/');
  return localFileAttachmentFromAbsolutePath(absolutePath, normalizedPath, options);
}

async function localFileAttachmentFromAbsolutePath(
  absolutePath: string,
  attachmentPath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error(`不是可引用的文件: ${attachmentPath}`);
  }

  const bytes = await readFile(absolutePath);
  const image = detectSupportedImageFile(absolutePath, bytes);
  if (image) {
    return {
      kind: 'image',
      path: attachmentPath,
      attachedAtUnixMs: Date.now(),
    };
  }

  if (hasSupportedImageExtension(absolutePath)) {
    throw new Error(`图片文件校验失败: ${attachmentPath}`);
  }

  if (bytes.includes(0)) {
    throw new Error(`暂不支持引用二进制文件: ${attachmentPath}`);
  }

  const text = bytes.toString('utf8');
  const chars = Array.from(text);
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const truncated = chars.length > maxContentChars;
  const content = truncated
    ? `${chars.slice(0, maxContentChars).join('')}\n\n...<文件内容已截断>`
    : text;

  return {
    kind: 'text',
    path: attachmentPath,
    totalChars: chars.length,
    truncated,
    attachedAtUnixMs: Date.now(),
    content,
  };
}

async function collectWorkspaceFileReferenceIndexUncached(workspaceRoot: string): Promise<string[]> {
  const rootMatchers = await readIgnoreMatchers(workspaceRoot, '');
  const files: string[] = [];

  await walkWorkspaceFiles(workspaceRoot, '', rootMatchers, files);
  return files;
}

async function walkWorkspaceFiles(
  workspaceRoot: string,
  currentDirRelPath: string,
  parentMatchers: readonly IgnoreMatcherEntry[],
  files: string[],
): Promise<void> {
  const currentDirAbsolutePath = currentDirRelPath
    ? resolve(workspaceRoot, ...currentDirRelPath.split('/'))
    : workspaceRoot;
  const currentMatchers = [...parentMatchers, ...(await readIgnoreMatchers(workspaceRoot, currentDirRelPath))];

  let entries;
  try {
    entries = await readdir(currentDirAbsolutePath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..' || entry.isSymbolicLink()) {
      continue;
    }

    const childRelPath = currentDirRelPath ? `${currentDirRelPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      if (shouldIgnoreWorkspacePath(childRelPath, true, currentMatchers)) {
        continue;
      }
      await walkWorkspaceFiles(workspaceRoot, childRelPath, currentMatchers, files);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }
    if (shouldIgnoreWorkspacePath(childRelPath, false, currentMatchers)) {
      continue;
    }

    files.push(childRelPath);
  }
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

function shouldIgnoreWorkspacePath(
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

async function resolveWorkspaceFileReferencePath(
  workspaceRoot: string,
  referencePath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const normalizedReferencePath = referencePath.replace(/\0/gu, '').replace(/\\/gu, '/').trim();
  if (!normalizedReferencePath) {
    throw new Error('未指定文件路径');
  }
  if (isAbsolute(referencePath) || normalizedReferencePath.startsWith('/')) {
    throw new Error(`不支持引用工作区外文件: ${referencePath}`);
  }

  const segments = normalizedReferencePath.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`不支持引用工作区外文件: ${referencePath}`);
    }
  }

  const workspaceRootResolved = await canonicalWorkspaceRoot(workspaceRoot);
  const targetPath = resolve(workspaceRootResolved, ...segments);
  const relativeTarget = relative(workspaceRootResolved, targetPath);
  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`不支持引用工作区外文件: ${referencePath}`);
  }

  const canonicalTarget = await realpath(targetPath);
  const canonicalRelativeTarget = relative(workspaceRootResolved, canonicalTarget);
  if (canonicalRelativeTarget.startsWith('..') || isAbsolute(canonicalRelativeTarget)) {
    throw new Error(`不支持引用工作区外文件: ${referencePath}`);
  }

  return {
    absolutePath: canonicalTarget,
    relativePath: canonicalRelativeTarget.replace(/\\/gu, '/'),
  };
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const resolved = resolve(workspaceRoot);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}
