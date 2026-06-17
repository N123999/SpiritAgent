import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import fg from 'fast-glob';

import {
  cachedIgnoreMatchersForRelativeDir,
  shouldIgnoreWorkspacePath,
} from './workspace-ignore.js';

const execFileAsync = promisify(execFile);
const GIT_LS_FILES_MAX_BUFFER = 64 * 1024 * 1024;
import {
  computeWorkspaceFileReferenceSuggestions,
  currentWorkspaceFileReferenceQuery,
  referencedWorkspaceFilePathsFromInput,
  type WorkspaceFileReferenceSuggestionsResult,
} from './workspace-file-reference-query.js';
import { detectSupportedImageFile, hasSupportedImageExtension } from './image-file-support.js';
import { detectSupportedVideoFile, hasSupportedVideoExtension } from './video-file-support.js';

const DEFAULT_MAX_CONTENT_CHARS = 24_000;
const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set(['.git', 'target', 'node_modules', 'bin', 'obj']);

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

export interface WorkspaceFileReferenceVideoAttachment {
  kind: 'video';
  path: string;
  attachedAtUnixMs: number;
}

export type WorkspaceFileReferenceAttachment =
  | WorkspaceFileReferenceTextAttachment
  | WorkspaceFileReferenceImageAttachment
  | WorkspaceFileReferenceVideoAttachment;

export interface ResolveWorkspaceFileReferenceAttachmentsOptions {
  maxContentChars?: number;
}

export interface WorkspaceFileReferenceIndexSnapshot {
  ready: boolean;
  files: string[];
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
    indexReady: true,
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
      indexReady: false,
    };
  }

  return {
    query,
    suggestions: computeWorkspaceFileReferenceSuggestions(query.raw, files),
    indexReady: true,
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

export async function getWorkspaceFileReferenceIndexSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceFileReferenceIndexSnapshot> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = workspaceFileIndexCache.get(root);
  if (!entry?.files) {
    return { ready: false, files: [] };
  }

  return {
    ready: true,
    files: [...entry.files],
  };
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

  const video = detectSupportedVideoFile(absolutePath, bytes);
  if (video) {
    return {
      kind: 'video',
      path: attachmentPath,
      attachedAtUnixMs: Date.now(),
    };
  }

  if (hasSupportedVideoExtension(absolutePath)) {
    throw new Error(`视频文件校验失败: ${attachmentPath}`);
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
  const viaGit = await collectWorkspaceFileIndexViaGit(workspaceRoot);
  if (viaGit !== null) {
    return viaGit;
  }

  return collectWorkspaceFileIndexViaFastGlob(workspaceRoot);
}

async function collectWorkspaceFileIndexViaGit(workspaceRoot: string): Promise<string[] | null> {
  try {
    await stat(resolve(workspaceRoot, '.git'));
  } catch {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: GIT_LS_FILES_MAX_BUFFER,
      },
    );

    return stdout
      .split('\0')
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/\\/gu, '/'))
      .filter((entry) => pathPassesDefaultIgnoredDirectories(entry));
  } catch {
    return null;
  }
}

async function collectWorkspaceFileIndexViaFastGlob(workspaceRoot: string): Promise<string[]> {
  const globIgnore = [
    '**/.git/**',
    ...Array.from(DEFAULT_IGNORED_DIRECTORY_NAMES).map((directory) => `**/${directory}/**`),
  ];

  const entries = await fg('**/*', {
    cwd: workspaceRoot,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: globIgnore,
  });

  const files: string[] = [];
  const matcherCache = new Map<string, Awaited<ReturnType<typeof cachedIgnoreMatchersForRelativeDir>>>();

  for (const entry of entries) {
    const relativePath = entry.replace(/\\/gu, '/');
    const parentDirRelPath = relativePath.includes('/')
      ? relativePath.slice(0, relativePath.lastIndexOf('/'))
      : '';
    if (
      parentDirRelPath
        .split('/')
        .some((segment) => DEFAULT_IGNORED_DIRECTORY_NAMES.has(segment))
    ) {
      continue;
    }

    const matchers = await cachedIgnoreMatchersForRelativeDir(
      workspaceRoot,
      parentDirRelPath,
      matcherCache,
    );
    if (shouldIgnoreWorkspacePath(relativePath, false, matchers)) {
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function pathPassesDefaultIgnoredDirectories(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/gu, '/').split('/');
  return !segments.some((segment) => DEFAULT_IGNORED_DIRECTORY_NAMES.has(segment));
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
