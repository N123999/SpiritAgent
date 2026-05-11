import assert from 'node:assert/strict';
import { test } from 'node:test';

import { restoreStoredSessionState } from '../../dist-electron/src/host/sessions.js';

test('restoreStoredSessionState ignores malformed desktop timeline snapshots', () => {
  const desktopMessages = [
    {
      id: 1,
      role: 'user',
      content: 'Inspect this file',
      pending: false,
    },
  ];

  const restored = restoreStoredSessionState({
    filePath: 'D:/SpiritAgent/test-session.json',
    loaded: {
      llmHistory: [],
      subagentSessions: [],
      desktopMessages,
      desktopMessageTimeline: [
        {
          turnId: 1,
          createdOrder: 1,
          segments: null,
        },
      ],
    },
    fallbackMessages: [],
  });

  assert.deepEqual(restored.messages, desktopMessages);
  assert.equal(restored.desktopMessageTimeline, undefined);
});