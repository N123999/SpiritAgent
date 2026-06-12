import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canForkMessage, canForkSession, canShowForkMessage } from '../../src/lib/fork-eligibility.ts';

const assistant = { id: 2, role: 'assistant', content: 'hi', pending: false };
const pendingAssistant = { id: 3, role: 'assistant', content: 'wait', pending: true };
const user = { id: 1, role: 'user', content: 'hello', pending: false };

test('canForkMessage allows completed assistant messages when session is idle', () => {
  assert.equal(
    canForkMessage({
      message: assistant,
      conversationBusy: false,
      activeSessionReadOnly: false,
      forkBusy: false,
    }),
    true,
  );
});

test('canForkMessage blocks pending assistant and user messages', () => {
  assert.equal(
    canForkMessage({
      message: pendingAssistant,
      conversationBusy: false,
      activeSessionReadOnly: false,
      forkBusy: false,
    }),
    false,
  );
  assert.equal(
    canForkMessage({
      message: user,
      conversationBusy: false,
      activeSessionReadOnly: false,
      forkBusy: false,
    }),
    false,
  );
});

test('canShowForkMessage stays visible while conversation is busy', () => {
  assert.equal(
    canShowForkMessage({
      message: assistant,
      activeSessionReadOnly: false,
    }),
    true,
  );
  assert.equal(
    canForkMessage({
      message: assistant,
      conversationBusy: true,
      activeSessionReadOnly: false,
      forkBusy: false,
    }),
    false,
  );
});

test('canForkSession requires idle writable session with forkable assistant', () => {
  assert.equal(
    canForkSession({
      conversationBusy: false,
      activeSessionReadOnly: false,
      forkBusy: false,
      hasForkableAssistantMessage: true,
    }),
    true,
  );
  assert.equal(
    canForkSession({
      conversationBusy: true,
      activeSessionReadOnly: false,
      forkBusy: false,
      hasForkableAssistantMessage: true,
    }),
    false,
  );
});
