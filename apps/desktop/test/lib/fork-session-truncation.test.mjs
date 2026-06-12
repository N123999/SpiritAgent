import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findLastForkableAssistantMessageId,
  resolveForkAnchorIndex,
  sanitizeTruncatedMessagesForFork,
  truncateMessagesThroughIndex,
} from '../../src/lib/fork-session-utils.ts';

const messages = [
  { id: 1, role: 'user', content: 'hi' },
  { id: 2, role: 'assistant', content: 'hello', pending: false },
  { id: 3, role: 'user', content: 'again' },
  { id: 4, role: 'assistant', content: 'sure', pending: false },
  { id: 5, role: 'assistant', content: 'streaming', pending: true },
];

test('resolveForkAnchorIndex accepts completed assistant messages', () => {
  assert.equal(resolveForkAnchorIndex(messages, 2), 1);
  assert.equal(resolveForkAnchorIndex(messages, 4), 3);
});

test('resolveForkAnchorIndex rejects user, pending, and unknown ids', () => {
  assert.equal(resolveForkAnchorIndex(messages, 1), null);
  assert.equal(resolveForkAnchorIndex(messages, 5), null);
  assert.equal(resolveForkAnchorIndex(messages, 99), null);
});

test('truncateMessagesThroughIndex keeps anchor inclusive and strips transient flags', () => {
  const truncated = truncateMessagesThroughIndex(messages, 3);
  assert.equal(truncated.length, 4);
  assert.equal(truncated.at(-1)?.content, 'sure');
  assert.equal(truncated.at(-1)?.canContinue, undefined);
  assert.equal(truncated.at(-1)?.pending, false);
});

test('sanitizeTruncatedMessagesForFork clears canContinue and pending', () => {
  const sanitized = sanitizeTruncatedMessagesForFork([
    { id: 1, role: 'assistant', content: 'x', pending: true, canContinue: true },
  ]);
  assert.equal(sanitized[0]?.pending, false);
  assert.equal(sanitized[0]?.canContinue, undefined);
});

test('findLastForkableAssistantMessageId skips pending assistant rows', () => {
  assert.equal(findLastForkableAssistantMessageId(messages), 4);
});
