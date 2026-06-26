import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CHAT_SCHEMA_VERSION,
  ChatSessionSchemaError,
  assertChatSchemaVersionV2,
  assertNoLegacyConversationFields,
  normalizeTimelineSnapshotForPersistence,
  timelinePersistedSnapshotToMessages,
  validateTimelineSnapshotV2,
} from '../../dist-electron/src/host/chat-schema.js';
import { loadStoredSession } from '../../dist-electron/src/host/storage.js';
import { buildV2StoredSession } from './chat-schema-fixture.mjs';

function toolRow(toolCallId) {
  return {
    rowId: `row-${toolCallId}`,
    messageId: 1,
    turnId: 1,
    segmentId: 1,
    kind: 'tool',
    section: 'tools',
    createdOrder: 2,
    pending: false,
    tool: {
      toolCallId,
      toolName: 'read_file',
      phase: 'succeeded',
      headline: 'Read file',
      detailLines: [],
      argsExcerpt: '{}',
    },
  };
}

function thinkingRow(thinking) {
  return {
    rowId: 'row-thinking',
    messageId: 2,
    turnId: 1,
    segmentId: 1,
    kind: 'assistant-thinking',
    section: 'before-tools',
    createdOrder: 1,
    pending: false,
    aux: { thinking },
  };
}

function textRow(content) {
  return {
    rowId: 'row-text',
    messageId: 3,
    turnId: 1,
    segmentId: 1,
    kind: 'assistant-text',
    section: 'after-tools',
    createdOrder: 3,
    content,
    pending: false,
  };
}

function sampleTurn(rows) {
  return [{
    turnId: 1,
    createdOrder: 1,
    userRow: {
      rowId: 'row-user',
      messageId: 1,
      turnId: 1,
      kind: 'user',
      createdOrder: 0,
      content: 'hello',
      pending: false,
    },
    segments: [{
      segmentId: 1,
      turnId: 1,
      kind: 'initial',
      status: 'completed',
      createdOrder: 1,
      rows,
    }],
  }];
}

test('normalizeTimelineSnapshotForPersistence omits empty content for tool and thinking rows', () => {
  const normalized = normalizeTimelineSnapshotForPersistence(sampleTurn([
    thinkingRow('reasoning'),
    toolRow('call-1'),
    textRow('answer'),
    {
      rowId: 'row-empty-text',
      messageId: 4,
      turnId: 1,
      segmentId: 1,
      kind: 'assistant-text',
      section: 'after-tools',
      createdOrder: 4,
      content: '',
      pending: false,
    },
  ]));

  const rows = normalized[0].segments[0].rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kind, 'assistant-thinking');
  assert.equal('content' in rows[0], false);
  assert.equal(rows[0].aux.thinking, 'reasoning');
  assert.equal(rows[1].kind, 'tool');
  assert.equal('content' in rows[1], false);
  assert.equal(rows[2].content, 'answer');
});

test('validateTimelineSnapshotV2 rejects empty assistant-text and legacy content on tool rows', () => {
  const valid = normalizeTimelineSnapshotForPersistence(sampleTurn([
    thinkingRow('reasoning'),
    toolRow('call-1'),
    textRow('answer'),
  ]));
  assert.doesNotThrow(() => validateTimelineSnapshotV2(valid));

  assert.throws(
    () => validateTimelineSnapshotV2(sampleTurn([
      {
        rowId: 'row-empty',
        messageId: 2,
        turnId: 1,
        segmentId: 1,
        kind: 'assistant-text',
        section: 'after-tools',
        createdOrder: 1,
        content: '',
        pending: false,
      },
    ])),
    ChatSessionSchemaError,
  );

  assert.throws(
    () => validateTimelineSnapshotV2(sampleTurn([
      {
        ...toolRow('call-1'),
        content: '',
      },
    ])),
    ChatSessionSchemaError,
  );
});

test('timelineSnapshotToMessages round-trips normalized thinking and tool rows', () => {
  const normalized = normalizeTimelineSnapshotForPersistence(sampleTurn([
    thinkingRow('reasoning'),
    toolRow('call-1'),
    textRow('answer'),
  ]));
  const messages = timelinePersistedSnapshotToMessages(normalized);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].content, '');
  assert.equal(messages[1].aux?.thinking, 'reasoning');
  assert.equal(messages[2].tool?.toolCallId, 'call-1');
  assert.equal(messages[3].content, 'answer');
});

test('loadStoredSession rejects legacy chat files without chatSchemaVersion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'spirit-chat-schema-'));
  const filePath = path.join(dir, 'legacy-chat.json');
  try {
    await writeFile(filePath, JSON.stringify({
      messages: [{ role: 'user', content: 'hello' }],
      assistantAux: [],
      llmHistory: [],
      subagentSessions: [],
      savedAtUnixMs: Date.now(),
    }, null, 2));
    await assert.rejects(
      () => loadStoredSession(filePath),
      (error) => error instanceof ChatSessionSchemaError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadStoredSession round-trips v2 stored session', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'spirit-chat-schema-'));
  const filePath = path.join(dir, 'v2-chat.json');
  try {
    const stored = buildV2StoredSession({ userContent: 'round trip' });
    await writeFile(filePath, JSON.stringify(stored, null, 2));
    const loaded = await loadStoredSession(filePath);
    assert.equal(loaded.chatSchemaVersion, CHAT_SCHEMA_VERSION);
    assert.equal(loaded.desktopMessageTimeline.length, 1);
    assert.equal(
      timelinePersistedSnapshotToMessages(loaded.desktopMessageTimeline)[0].content,
      'round trip',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('assertChatSchemaVersionV2 and assertNoLegacyConversationFields enforce v2 shape', () => {
  assert.equal(CHAT_SCHEMA_VERSION, 2);
  assert.throws(() => assertChatSchemaVersionV2(1), ChatSessionSchemaError);
  assert.throws(() => assertNoLegacyConversationFields({ messages: [] }), ChatSessionSchemaError);
  assert.throws(() => assertNoLegacyConversationFields({ assistantAux: [] }), ChatSessionSchemaError);
  assert.throws(() => assertNoLegacyConversationFields({ desktopMessages: [] }), ChatSessionSchemaError);
  assert.doesNotThrow(() => assertNoLegacyConversationFields({ chatSchemaVersion: 2 }));
});
