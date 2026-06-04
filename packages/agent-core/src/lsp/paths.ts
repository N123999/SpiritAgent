import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { TYPESCRIPT_JS_EXTENSIONS } from './constants.js';
import { LspPathError } from './errors.js';

export function isTypescriptJavascriptPath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return TYPESCRIPT_JS_EXTENSIONS.has(extension);
}

export function languageIdForExtension(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  switch (extension) {
    case '.tsx':
      return 'typescriptreact';
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.jsx':
      return 'javascriptreact';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    default:
      return 'typescript';
  }
}

export function resolveWorkspaceFilePath(workspaceRoot: string, inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new LspPathError('path is required');
  }
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const normalizedRoot = path.resolve(workspaceRoot);
  const relative = path.relative(normalizedRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LspPathError(`path must stay within the workspace: ${inputPath}`);
  }
  return absolute;
}

export function relativePathFromWorkspace(workspaceRoot: string, resolvedPath: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(resolvedPath)).replace(/\\/g, '/');
}

function normalizeWindowsDriveLetter(filePath: string): string {
  if (process.platform !== 'win32') {
    return filePath;
  }
  return filePath.replace(/^([a-zA-Z]):/, (_match, letter: string) => `${letter.toUpperCase()}:`);
}

/** 统一 file URI（Windows 上 TLS 可能返回 `file:///d%3A/...` 或盘符大小写不一致）。 */
export function normalizeLspFileUri(uri: string): string {
  if (!uri.startsWith('file:')) {
    return uri;
  }
  try {
    return pathToFileURL(normalizeWindowsDriveLetter(fileURLToPath(uri))).href;
  } catch {
    return uri;
  }
}

export function fileUriForResolvedPath(resolvedPath: string): string {
  return normalizeLspFileUri(pathToFileURL(path.resolve(resolvedPath)).href);
}

export function parseLspFileChangeNotification(value: unknown): import('./types.js').LspFileChangeNotification | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== 'create_file' && kind !== 'edit_file' && kind !== 'delete_file') {
    return undefined;
  }
  if (typeof record.path !== 'string' || typeof record.resolvedPath !== 'string') {
    return undefined;
  }
  const before = readSnapshot(record.before);
  const after = readSnapshot(record.after);
  if (!before || !after) {
    return undefined;
  }
  return {
    kind,
    path: record.path,
    resolvedPath: record.resolvedPath,
    before,
    after,
  };
}

function readSnapshot(value: unknown): import('./types.js').LspFileSnapshot | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.exists !== 'boolean') {
    return undefined;
  }
  return {
    exists: record.exists,
    ...(typeof record.content === 'string' ? { content: record.content } : {}),
  };
}
