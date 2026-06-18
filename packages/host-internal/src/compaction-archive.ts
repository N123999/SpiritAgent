import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PreCompactionHistoryArchive } from '@spirit-agent/core';

import { sanitizeSessionIdForFilename } from './spirit-filename-sanitize.js';

export const COMPACTION_ARCHIVES_DIR_NAME = 'compaction-archives';

export function resolveCompactionArchivesDir(spiritDataDir: string): string {
  return path.join(spiritDataDir, COMPACTION_ARCHIVES_DIR_NAME);
}

export function buildPreCompactionArchiveFileName(
  sessionId: string | undefined,
  exportedAtUnixMs: number,
): string {
  return `pre-compact-${sanitizeSessionIdForFilename(sessionId)}-${exportedAtUnixMs}.json`;
}

export async function persistPreCompactionHistoryArchive(
  spiritDataDir: string,
  archive: PreCompactionHistoryArchive,
  options: { sessionId?: string } = {},
): Promise<string> {
  const archivesDir = resolveCompactionArchivesDir(spiritDataDir);
  await mkdir(archivesDir, { recursive: true });

  const fileName = buildPreCompactionArchiveFileName(options.sessionId, archive.exported_at_unix_ms);
  const filePath = path.join(archivesDir, fileName);
  await writeFile(filePath, `${JSON.stringify(archive, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function removePreCompactionHistoryArchive(archivePath: string): Promise<void> {
  await unlink(archivePath);
}
