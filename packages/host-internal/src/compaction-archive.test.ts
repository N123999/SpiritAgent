import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildPreCompactionArchiveFileName,
  persistPreCompactionHistoryArchive,
  resolveCompactionArchivesDir,
} from './compaction-archive.js';

test('persistPreCompactionHistoryArchive writes filtered archive JSON under compaction-archives', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-compaction-archive-'));

  try {
    const archive = {
      export_version: 1 as const,
      kind: 'pre_compaction_history' as const,
      exported_at_unix_ms: 1_700_000_000_000,
      message_count: 1,
      messages: [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'hello' }],
        },
      ],
    };

    const filePath = await persistPreCompactionHistoryArchive(spiritDataDir, archive, {
      sessionId: 'session/1',
    });

    assert.equal(filePath, join(resolveCompactionArchivesDir(spiritDataDir), buildPreCompactionArchiveFileName('session/1', archive.exported_at_unix_ms)));
    const written = JSON.parse(await readFile(filePath, 'utf8')) as typeof archive;
    assert.deepEqual(written, archive);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
