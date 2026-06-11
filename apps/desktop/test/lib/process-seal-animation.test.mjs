import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLiveComposeViewKey,
  resolveProcessSealLiveTurnActive,
} from '../../src/lib/process-seal-animation.ts';

test('isLiveComposeViewKey detects compose view keys', () => {
  assert.equal(isLiveComposeViewKey('__no-session__:main'), true);
  assert.equal(isLiveComposeViewKey('todo-scope:abc:main'), true);
  assert.equal(isLiveComposeViewKey('/tmp/chat.json:main'), false);
});

test('resolveProcessSealLiveTurnActive is false during session navigation busy state', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: 'session',
      messages: [],
    }),
    false,
  );
});

test('resolveProcessSealLiveTurnActive is true while send is in flight', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: 'send',
      messages: [],
    }),
    true,
  );
});

test('resolveProcessSealLiveTurnActive is true while pending aux is live', () => {
  assert.equal(
    resolveProcessSealLiveTurnActive({
      subagentViewActive: false,
      compactionDemoActive: false,
      isBusy: false,
      busyAction: null,
      pendingAuxState: { kind: 'thinking' },
      messages: [],
    }),
    true,
  );
});
