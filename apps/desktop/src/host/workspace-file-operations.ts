import { lstat, mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import { resolveWorkspaceRelativePath } from './workspace-files.js';

export function validateEntryName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error(i18n.t('error.invalidFileName'));
  }
  if (/[\0/\\]/.test(trimmed)) {
    throw new Error(i18n.t('error.invalidFileName'));
  }
}

export function joinWorkspaceRelativePath(parentRel: string, name: string): string {
  return parentRel === '' ? name : `${parentRel}/${name}`;
}

export function parentWorkspaceRelativePath(relativePath: string): string {
  const posix = relativePath.replace(/\\/g, '/');
  const index = posix.lastIndexOf('/');
  return index >= 0 ? posix.slice(0, index) : '';
}

export function isDescendantOrSelf(ancestorRel: string, candidateRel: string): boolean {
  const ancestor = ancestorRel.replace(/\\/g, '/');
  const candidate = candidateRel.replace(/\\/g, '/');
  if (ancestor === candidate) {
    return true;
  }
  // 空 ancestor 仅匹配自身；moveIntoSelf 校验时 sourceRel 已保证非空。
  if (ancestor === '') {
    return false;
  }
  return candidate.startsWith(`${ancestor}/`);
}

async function assertTargetDoesNotExist(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, relativePath);
  try {
    await stat(absPath);
    throw new Error(i18n.t('error.fileAlreadyExists'));
  } catch (error) {
    if (error instanceof Error && error.message === i18n.t('error.fileAlreadyExists')) {
      throw error;
    }
  }
}

async function assertParentDirectoryExists(
  workspaceRoot: string,
  parentDirectoryRel: string,
): Promise<void> {
  const parentAbs = await resolveWorkspaceRelativePath(workspaceRoot, parentDirectoryRel);
  const parentStat = await stat(parentAbs);
  if (!parentStat.isDirectory()) {
    throw new Error(i18n.t('error.notADirectory'));
  }
}

export type WorkspaceEntryKind = 'file' | 'dir';

export async function createWorkspaceEntry(
  workspaceRoot: string,
  parentDirectoryRel: string,
  name: string,
  kind: WorkspaceEntryKind,
): Promise<{ relativePath: string }> {
  validateEntryName(name);
  const parentRel = parentDirectoryRel.replace(/\\/g, '/').trim();
  const trimmedName = name.trim();
  const newRel = joinWorkspaceRelativePath(parentRel, trimmedName);

  await assertParentDirectoryExists(workspaceRoot, parentRel);
  await assertTargetDoesNotExist(workspaceRoot, newRel);

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, newRel);
  if (kind === 'dir') {
    await mkdir(absPath);
  } else {
    await writeFile(absPath, '', 'utf8');
  }
  return { relativePath: newRel };
}

export async function renameWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  newName: string,
): Promise<{ relativePath: string }> {
  validateEntryName(newName);
  const sourceRel = relativePath.replace(/\\/g, '/').trim();
  if (!sourceRel) {
    throw new Error(i18n.t('error.invalidPath'));
  }

  const parentRel = parentWorkspaceRelativePath(sourceRel);
  const trimmedName = newName.trim();
  const newRel = joinWorkspaceRelativePath(parentRel, trimmedName);
  if (newRel === sourceRel) {
    return { relativePath: newRel };
  }

  await assertTargetDoesNotExist(workspaceRoot, newRel);

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, sourceRel);
  const newAbs = await resolveWorkspaceRelativePath(workspaceRoot, newRel);
  await rename(absPath, newAbs);
  return { relativePath: newRel };
}

export async function moveWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
  targetDirectoryRel: string,
): Promise<{ relativePath: string }> {
  const sourceRel = relativePath.replace(/\\/g, '/').trim();
  if (!sourceRel) {
    throw new Error(i18n.t('error.invalidPath'));
  }

  const targetDir = targetDirectoryRel.replace(/\\/g, '/').trim();
  if (isDescendantOrSelf(sourceRel, targetDir)) {
    throw new Error(i18n.t('error.moveIntoSelf'));
  }

  const targetAbs = await resolveWorkspaceRelativePath(workspaceRoot, targetDir);
  const targetStat = await stat(targetAbs);
  if (!targetStat.isDirectory()) {
    throw new Error(i18n.t('error.notADirectory'));
  }

  const basename = path.posix.basename(sourceRel);
  const newRel = joinWorkspaceRelativePath(targetDir, basename);
  if (newRel === sourceRel) {
    return { relativePath: sourceRel };
  }

  await assertTargetDoesNotExist(workspaceRoot, newRel);

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, sourceRel);
  const newAbs = await resolveWorkspaceRelativePath(workspaceRoot, newRel);
  await rename(absPath, newAbs);
  return { relativePath: newRel };
}

export async function forceDeleteWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const sourceRel = relativePath.replace(/\\/g, '/').trim();
  if (!sourceRel) {
    throw new Error(i18n.t('error.invalidPath'));
  }

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, sourceRel);
  const entry = await lstat(absPath);
  if (entry.isDirectory()) {
    await rm(absPath, { recursive: true, force: true });
    return;
  }
  await unlink(absPath);
}

export class WorkspaceTrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceTrashError';
  }
}

export async function trashWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const sourceRel = relativePath.replace(/\\/g, '/').trim();
  if (!sourceRel) {
    throw new Error(i18n.t('error.invalidPath'));
  }

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, sourceRel);
  try {
    const { shell } = await import('electron');
    await shell.trashItem(absPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.debug('[workspace-file-operations] trashWorkspaceEntry failed', {
      relativePath: sourceRel,
      error: message,
    });
    throw new WorkspaceTrashError(message);
  }
}

export async function revealWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  const sourceRel = relativePath.replace(/\\/g, '/').trim();
  if (!sourceRel) {
    const absRoot = path.resolve(workspaceRoot);
    const { shell } = await import('electron');
    const result = await shell.openPath(absRoot);
    if (result) {
      throw new Error(result);
    }
    return;
  }

  const absPath = await resolveWorkspaceRelativePath(workspaceRoot, sourceRel);
  const entry = await stat(absPath);
  const { shell } = await import('electron');
  if (entry.isDirectory()) {
    const result = await shell.openPath(absPath);
    if (result) {
      throw new Error(result);
    }
    return;
  }
  shell.showItemInFolder(absPath);
}
