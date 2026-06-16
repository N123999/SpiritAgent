import { Buffer } from 'node:buffer';
import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceExplorerIgnoreFlags } from '@spirit-agent/host-internal';

import i18n from '../lib/i18n-host.js';
import type {
  WorkspaceExplorerEntry,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';

/** 单文件上限，避免大文件拖垮渲染进程。 */
export const WORKSPACE_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 将工作区相对路径解析为绝对路径；使用 `/` 分段，禁止 `..` 与绝对路径。
 */
export async function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  relativePath: string,
): Promise<string> {
  const root = path.resolve(workspaceRoot);
  const canonicalRoot = await realpath(root);
  const cleaned = relativePath.replace(/\0/g, '');
  const posix = cleaned.replace(/\\/g, '/').trim();
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
    throw new Error(i18n.t('error.invalidPath'));
  }
  const segments = posix.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error(i18n.t('error.invalidPath'));
    }
  }

  const target = segments.length === 0 ? root : path.resolve(root, ...segments);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(i18n.t('error.pathOutsideWorkspace'));
  }

  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(i18n.t('error.pathContainsSymlink'));
      }
    } catch (error) {
      if (error instanceof Error && error.message === i18n.t('error.pathContainsSymlink')) {
        throw error;
      }
      break;
    }
  }

  try {
    const canonicalTarget = await realpath(target);
    const canonicalRel = path.relative(canonicalRoot, canonicalTarget);
    if (canonicalRel.startsWith('..') || path.isAbsolute(canonicalRel)) {
      throw new Error(i18n.t('error.pathOutsideWorkspace'));
    }
  } catch (error) {
    if (error instanceof Error && error.message === i18n.t('error.pathOutsideWorkspace')) {
      throw error;
    }
  }

  return target;
}

export async function listWorkspaceExplorerChildren(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceExplorerListResult> {
  const dir = await resolveWorkspaceRelativePath(workspaceRoot, relativePath);
  let fileStat;
  try {
    fileStat = await stat(dir);
  } catch {
    return { entries: [] };
  }
  if (!fileStat.isDirectory()) {
    return { entries: [] };
  }
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries: WorkspaceExplorerEntry[] = dirents
    .filter((dirent) => dirent.name && dirent.name !== '.' && dirent.name !== '..')
    .map((dirent) => ({
      name: dirent.name,
      kind: dirent.isDirectory() ? 'dir' : 'file',
    }));
  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'dir' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  const normalizedParent = relativePath.replace(/\\/g, '/').trim();
  let ignoreFlags: boolean[];
  try {
    ignoreFlags = await resolveWorkspaceExplorerIgnoreFlags(workspaceRoot, normalizedParent, entries, {
      preferInProcess: true,
    });
  } catch {
    ignoreFlags = entries.map(() => false);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (ignoreFlags[index]) {
      entries[index]!.ignored = true;
    }
  }

  return { entries };
}

export async function readWorkspaceTextFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceReadTextFileResult> {
  const posix = relativePath.replace(/\0/g, '').replace(/\\/g, '/').trim();
  if (!posix) {
    throw new Error(i18n.t('error.noFilePath'));
  }
  const filePath = await resolveWorkspaceRelativePath(workspaceRoot, relativePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(i18n.t('error.fileNotAccessible'));
  }
  if (!fileStat.isFile()) {
    throw new Error(i18n.t('error.notAFile'));
  }
  if (fileStat.size > WORKSPACE_TEXT_FILE_MAX_BYTES) {
    throw new Error(i18n.t('error.fileTooLarge'));
  }
  const buffer = await readFile(filePath);
  return { text: buffer.toString('utf8') };
}

export async function writeWorkspaceTextFile(
  workspaceRoot: string,
  request: WriteWorkspaceTextFileRequest,
): Promise<void> {
  const posix = request.relativePath.replace(/\0/g, '').replace(/\\/g, '/').trim();
  if (!posix) {
    throw new Error(i18n.t('error.noFilePath'));
  }
  const filePath = await resolveWorkspaceRelativePath(workspaceRoot, request.relativePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(i18n.t('error.fileNotAccessible'));
  }
  if (!fileStat.isFile()) {
    throw new Error(i18n.t('error.onlyRegularFile'));
  }
  const bytes = Buffer.byteLength(request.text, 'utf8');
  if (bytes > WORKSPACE_TEXT_FILE_MAX_BYTES) {
    throw new Error(i18n.t('error.contentTooLarge'));
  }
  await writeFile(filePath, request.text, 'utf8');
}
