import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildToolOutputArchiveFileName,
  persistToolOutputArchive,
  resolveToolOutputArchivesDir,
  TOOL_OUTPUT_ARCHIVES_DIR_NAME,
} from './tool-output-archive.js';
import {
  sanitizeSessionIdForFilename,
  sanitizeToolCallIdForFilename,
} from './spirit-filename-sanitize.js';

test('sanitizeSessionIdForFilename normalizes unsafe characters', () => {
  assert.equal(sanitizeSessionIdForFilename('session/abc:123'), 'session-abc-123');
  assert.equal(sanitizeSessionIdForFilename(undefined), 'unknown');
});

test('sanitizeToolCallIdForFilename falls back to message index', () => {
  assert.equal(sanitizeToolCallIdForFilename('call_abc/123'), 'call_abc-123');
  assert.equal(sanitizeToolCallIdForFilename(undefined, 4), 'msg-4');
});

test('buildToolOutputArchiveFileName uses sanitized tool call id', () => {
  assert.equal(buildToolOutputArchiveFileName('call:1'), 'call-1.txt');
});

test('persistToolOutputArchive writes session-scoped archive with header', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-tool-output-archive-'));

  try {
    const filePath = await persistToolOutputArchive(spiritDataDir, {
      sessionId: 'sess/one',
      toolCallId: 'call_123',
      content: 'full tool output body',
    });

    assert.match(filePath, /tool-output-archives[\\/]sess-one[\\/]call_123\.txt$/u);
    const body = await readFile(filePath, 'utf8');
    assert.match(body, /^# spirit-tool-output-archive/u);
    assert.match(body, /# tool_call_id: call_123/u);
    assert.match(body, /# archived_at_unix_ms: \d+/u);
    assert.match(body, /---\nfull tool output body/u);
    assert.equal(resolveToolOutputArchivesDir(spiritDataDir).endsWith(TOOL_OUTPUT_ARCHIVES_DIR_NAME), true);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test('persistToolOutputArchive overwrites the same tool call archive path', async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), 'spirit-tool-output-archive-overwrite-'));

  try {
    const firstPath = await persistToolOutputArchive(spiritDataDir, {
      sessionId: 'sess',
      toolCallId: 'call_a',
      content: 'first',
    });
    const secondPath = await persistToolOutputArchive(spiritDataDir, {
      sessionId: 'sess',
      toolCallId: 'call_a',
      content: 'second',
    });

    assert.equal(firstPath, secondPath);
    const body = await readFile(secondPath, 'utf8');
    assert.match(body, /second/u);
    assert.doesNotMatch(body, /\nfirst$/u);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
