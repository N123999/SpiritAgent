import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canStartMessageRewind } from '../../src/lib/message-rewind-eligibility.ts';

const rewindableMessage = { id: 'm1', canRewind: true };

test('allows rewind when composer rewind mode is enabled and message is rewindable', () => {
  assert.equal(
    canStartMessageRewind({ messageRewindComposerEnabled: true, message: rewindableMessage }),
    true,
  );
});

test('blocks rewind when composer rewind mode is disabled', () => {
  assert.equal(
    canStartMessageRewind({ messageRewindComposerEnabled: false, message: rewindableMessage }),
    false,
  );
});

test('blocks rewind when message.canRewind is not true', () => {
  assert.equal(
    canStartMessageRewind({
      messageRewindComposerEnabled: true,
      message: { id: 'm2', canRewind: false },
    }),
    false,
  );
});

test('blocks rewind when message.canRewind is undefined', () => {
  assert.equal(
    canStartMessageRewind({
      messageRewindComposerEnabled: true,
      message: { id: 'm3' },
    }),
    false,
  );
});
