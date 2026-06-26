import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAT_SCHEMA_VERSION,
  normalizeTimelineSnapshotForPersistence,
} from '../../dist-electron/src/host/chat-schema.js';
import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';

export function buildV2TimelineFromUserMessage(content) {
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn(content);
  return normalizeTimelineSnapshotForPersistence(timeline.snapshot());
}

export function buildV2StoredSession(overrides = {}) {
  const desktopMessageTimeline = overrides.desktopMessageTimeline
    ?? buildV2TimelineFromUserMessage(overrides.userContent ?? 'hello');
  return {
    chatSchemaVersion: CHAT_SCHEMA_VERSION,
    llmHistory: overrides.llmHistory ?? [],
    subagentSessions: [],
    loopEnabled: false,
    approvalLevel: 'default',
    desktopMessageTimeline,
    savedAtUnixMs: overrides.savedAtUnixMs ?? Date.now(),
    sessionDisplayName: overrides.sessionDisplayName ?? 'hello',
    workspaceRoot: overrides.workspaceRoot ?? 'D:/SpiritAgent',
    rewind: overrides.rewind,
    contextUsage: overrides.contextUsage,
    ...overrides,
  };
}

test('buildV2StoredSession helper produces valid v2 shape', () => {
  const stored = buildV2StoredSession();
  assert.equal(stored.chatSchemaVersion, 2);
  assert.equal(stored.desktopMessageTimeline.length, 1);
  assert.equal(stored.desktopMessageTimeline[0].userRow.content, 'hello');
});
