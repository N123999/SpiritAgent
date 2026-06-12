import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPreCompactionHistoryArchive } from './compaction-archive.js';
import { COMPACT_SUMMARY_PREFIX } from './tool-agent.js';
import {
  buildCompactHistorySystemPrompt,
  buildCompactHistoryPromptMessages,
} from './tool-agent.js';
import { createLlmMessageContentFromText } from './ports.js';

test('buildPreCompactionHistoryArchive keeps user and assistant messages with toolCalls', () => {
  const archive = buildPreCompactionHistoryArchive(
    [
      {
        role: 'system',
        content: createLlmMessageContentFromText(`${COMPACT_SUMMARY_PREFIX}\nold summary`),
      },
      {
        role: 'user',
        content: createLlmMessageContentFromText('hello'),
      },
      {
        role: 'assistant',
        content: [],
        toolCalls: [{ id: 'call-1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: createLlmMessageContentFromText('file contents'),
      },
      {
        role: 'assistant',
        content: createLlmMessageContentFromText('done'),
      },
    ],
    1_700_000_000_000,
  );

  assert.equal(archive.export_version, 1);
  assert.equal(archive.kind, 'pre_compaction_history');
  assert.equal(archive.exported_at_unix_ms, 1_700_000_000_000);
  assert.equal(archive.message_count, 3);
  assert.equal(archive.messages.length, 3);
  assert.equal(archive.messages[0]?.role, 'user');
  assert.equal(archive.messages[1]?.role, 'assistant');
  assert.deepEqual(archive.messages[1]?.toolCalls, [
    { id: 'call-1', name: 'read_file', argumentsJson: '{"path":"a.ts"}' },
  ]);
  assert.equal(archive.messages[2]?.role, 'assistant');
  assert.equal(archive.messages[2]?.toolCalls, undefined);
});

test('buildCompactHistorySystemPrompt includes archive path when provided', () => {
  const path = '/data/compaction-archives/pre-compact-s1.json';
  const prompt = buildCompactHistorySystemPrompt(path);
  assert.match(prompt, /Pre-compaction history archive path \(use this exact path in \[Pre-compaction Archive\]\): \/data\/compaction-archives\/pre-compact-s1\.json/);
  assert.match(prompt, /\[Pre-compaction Archive\]/);
});

test('buildCompactHistoryPromptMessages forwards archive path into system prompt', () => {
  const messages = buildCompactHistoryPromptMessages(
    [{ role: 'user', content: createLlmMessageContentFromText('hi') }],
    { preCompactionArchivePath: '/tmp/archive.json' },
  );

  assert.equal(messages[0]?.role, 'system');
  assert.match(messages[0]?.content ?? '', /\/tmp\/archive\.json/);
  assert.equal(messages[1]?.role, 'user');
  assert.match(messages[1]?.content ?? '', /USER: hi/);
});
