import { Buffer } from 'node:buffer';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  WorkspaceExplorerEntry,
  WorkspaceExplorerListResult,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
} from '../types.js';

/** 单文件上限，避免大文件拖垮渲染进程。 */
const WORKSPACE_TEXT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 将工作区相对路径解析为绝对路径；使用 `/` 分段，禁止 `..` 与绝对路径。
 */
export function resolveWorkspaceRelativePath(workspaceRoot: string, relativePath: string): string {
  const root = path.resolve(workspaceRoot);
  const cleaned = relativePath.replace(/\0/g, '');
  const posix = cleaned.replace(/\\/g, '/').trim();
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
    throw new Error('无效路径');
  }
  const segments = posix.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new Error('无效路径');
    }
  }
  const target = segments.length === 0 ? root : path.resolve(root, ...segments);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越出工作区');
  }
  return target;
}

export async function listWorkspaceExplorerChildren(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceExplorerListResult> {
  const dir = resolveWorkspaceRelativePath(workspaceRoot, relativePath);
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
  return { entries };
}

export async function readWorkspaceTextFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceReadTextFileResult> {
  const posix = relativePath.replace(/\0/g, '').replace(/\\/g, '/').trim();
  if (!posix) {
    throw new Error('未指定文件路径');
  }
  const filePath = resolveWorkspaceRelativePath(workspaceRoot, relativePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error('文件不存在或无法访问');
  }
  if (!fileStat.isFile()) {
    throw new Error('不是文件');
  }
  if (fileStat.size > WORKSPACE_TEXT_FILE_MAX_BYTES) {
    throw new Error('文件过大，无法在侧栏打开');
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
    throw new Error('未指定文件路径');
  }
  const filePath = resolveWorkspaceRelativePath(workspaceRoot, request.relativePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error('文件不存在或无法访问');
  }
  if (!fileStat.isFile()) {
    throw new Error('只能保存为普通文件');
  }
  const bytes = Buffer.byteLength(request.text, 'utf8');
  if (bytes > WORKSPACE_TEXT_FILE_MAX_BYTES) {
    throw new Error('内容过大，无法保存');
  }
  await writeFile(filePath, request.text, 'utf8');
}
