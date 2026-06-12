import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PreCompactionHistoryArchive } from '@spirit-agent/core';

export const COMPACTION_ARCHIVES_DIR_NAME = 'compaction-archives';

export function resolveCompactionArchivesDir(spiritDataDir: string): string {
  return path.join(spiritDataDir, COMPACTION_ARCHIVES_DIR_NAME);
}

function sanitizeSessionIdForFilename(sessionId: string | undefined): string {
  const normalized = sessionId?.trim();
  if (!normalized) {
    return 'unknown';
  }

  const sanitized = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown';
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
