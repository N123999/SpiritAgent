import { Buffer } from 'node:buffer';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import type { HostTextFileStatResult, WorkspaceReadTextFileResult } from '../types.js';

import {
  WORKSPACE_IMAGE_FILE_MAX_BYTES,
  WORKSPACE_TEXT_FILE_MAX_BYTES,
  workspaceTextFileResultFromBuffer,
} from './workspace-files.js';
import { hasSupportedImageExtension } from '@spirit-agent/host-internal/image-file-support';

export async function resolveHostTextFilePath(absolutePath: string): Promise<string> {
  const cleaned = absolutePath.replace(/\0/g, '').trim();
  if (!cleaned) {
    throw new Error(i18n.t('error.noFilePath'));
  }
  const resolved = path.resolve(cleaned);
  if (!path.isAbsolute(resolved)) {
    throw new Error(i18n.t('error.invalidPath'));
  }
  return realpath(resolved);
}

export async function statHostTextFile(absolutePath: string): Promise<HostTextFileStatResult> {
  const cleaned = absolutePath.replace(/\0/g, '').trim();
  if (!cleaned) {
    return { exists: false, isFile: false };
  }
  const resolved = path.resolve(cleaned);
  if (!path.isAbsolute(resolved)) {
    return { exists: false, isFile: false };
  }
  try {
    const fileStat = await stat(resolved);
    return { exists: true, isFile: fileStat.isFile() };
  } catch {
    return { exists: false, isFile: false };
  }
}

export async function readHostTextFile(absolutePath: string): Promise<WorkspaceReadTextFileResult> {
  const filePath = await resolveHostTextFilePath(absolutePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(i18n.t('error.fileNotAccessible'));
  }
  if (!fileStat.isFile()) {
    throw new Error(i18n.t('error.notAFile'));
  }
  if (fileStat.size > (hasSupportedImageExtension(filePath) ? WORKSPACE_IMAGE_FILE_MAX_BYTES : WORKSPACE_TEXT_FILE_MAX_BYTES)) {
    throw new Error(i18n.t('error.fileTooLarge'));
  }
  const buffer = await readFile(filePath);
  return workspaceTextFileResultFromBuffer(buffer, filePath);
}

export async function writeHostTextFile(absolutePath: string, text: string): Promise<void> {
  const filePath = await resolveHostTextFilePath(absolutePath);
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(i18n.t('error.fileNotAccessible'));
  }
  if (!fileStat.isFile()) {
    throw new Error(i18n.t('error.onlyRegularFile'));
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > WORKSPACE_TEXT_FILE_MAX_BYTES) {
    throw new Error(i18n.t('error.contentTooLarge'));
  }
  await writeFile(filePath, text, 'utf8');
}
