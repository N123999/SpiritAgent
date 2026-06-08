import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendQueuedUserTurnSnapshots,
  canDrainQueuedUserTurn,
  canEnqueueUserTurn,
  isSessionBundleQueueBlocked,
  moveQueuedUserTurnUp,
  projectQueuedUserTurnSnapshots,
  removeQueuedUserTurn,
  shiftNextQueuedUserTurn,
} from '../../dist-electron/src/host/message-queue.js';
import { createEmptySessionBundle } from '../../dist-electron/src/host/session-bundle.js';
import { cloneQueuedUserTurns } from '../../dist-electron/src/host/sessions.js';

function createBundle(overrides = {}) {
  const bundle = createEmptySessionBundle('/tmp/workspace');
  return {
    ...bundle,
    activeSession: { filePath: '/tmp/chat.json', displayName: 'Test', kind: 'stored' },
    queuedUserTurns: [],
    ...overrides,
  };
}

function queuedItem(id, messageId, content) {
  return {
    queueId: id,
    messageId,
    text: content,
    displayText: content,
    enqueuedAtUnixMs: Date.now(),
  };
}

test('projectQueuedUserTurnSnapshots marks user rows as queued', () => {
  const snapshots = projectQueuedUserTurnSnapshots([
    queuedItem('a', 10, 'hello queue'),
  ]);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].role, 'user');
  assert.equal(snapshots[0].queued, true);
  assert.equal(snapshots[0].content, 'hello queue');
});

test('appendQueuedUserTurnSnapshots appends after visible messages', () => {
  const merged = appendQueuedUserTurnSnapshots(
    [{ id: 1, role: 'assistant', content: 'reply', pending: false }],
    [queuedItem('a', 2, 'next')],
  );
  assert.deepEqual(
    merged.map((message) => `${message.role}:${message.content}:${message.queued === true}`),
    ['assistant:reply:false', 'user:next:true'],
  );
});

test('canEnqueueUserTurn requires busy non-blocked session', () => {
  const idleBundle = createBundle({
    runtime: { isBusy: () => false, currentPendingApproval: () => undefined, currentPendingQuestions: () => undefined },
  });
  assert.equal(canEnqueueUserTurn(idleBundle), false);

  const busyBundle = createBundle({
    runtime: { isBusy: () => true, currentPendingApproval: () => undefined, currentPendingQuestions: () => undefined },
  });
  assert.equal(canEnqueueUserTurn(busyBundle), true);

  const blockedBundle = createBundle({
    runtime: {
      isBusy: () => true,
      currentPendingApproval: () => ({ toolName: 'bash' }),
      currentPendingQuestions: () => undefined,
    },
  });
  assert.equal(isSessionBundleQueueBlocked(blockedBundle), true);
  assert.equal(canEnqueueUserTurn(blockedBundle), false);
});

test('canDrainQueuedUserTurn requires idle queue with items', () => {
  const bundle = createBundle({
    queuedUserTurns: [queuedItem('a', 1, 'one')],
    runtime: { isBusy: () => false, currentPendingApproval: () => undefined, currentPendingQuestions: () => undefined },
  });
  assert.equal(canDrainQueuedUserTurn(bundle), true);

  bundle.runtime = { isBusy: () => true, currentPendingApproval: () => undefined, currentPendingQuestions: () => undefined };
  assert.equal(canDrainQueuedUserTurn(bundle), false);
});

test('moveQueuedUserTurnUp swaps with previous item', () => {
  const bundle = createBundle({
    queuedUserTurns: [queuedItem('a', 1, 'one'), queuedItem('b', 2, 'two')],
  });
  assert.equal(moveQueuedUserTurnUp(bundle, 'b'), true);
  assert.deepEqual(bundle.queuedUserTurns.map((item) => item.queueId), ['b', 'a']);
  assert.equal(moveQueuedUserTurnUp(bundle, 'b'), false);
});

test('cloneQueuedUserTurns deep-copies queue payload', () => {
  const source = [
    {
      ...queuedItem('a', 1, 'one'),
      explicitWorkspaceFiles: [{ kind: 'image', path: '/tmp/a.png', attachedAtUnixMs: 1 }],
    },
  ];
  const cloned = cloneQueuedUserTurns(source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned[0].explicitWorkspaceFiles, source[0].explicitWorkspaceFiles);
  cloned[0].explicitWorkspaceFiles[0].path = '/tmp/b.png';
  assert.equal(source[0].explicitWorkspaceFiles[0].path, '/tmp/a.png');
});

test('shift then unshift restores queue head after failed dequeue', () => {
  const bundle = createBundle({
    queuedUserTurns: [queuedItem('a', 1, 'one'), queuedItem('b', 2, 'two')],
  });
  const removed = shiftNextQueuedUserTurn(bundle);
  assert.equal(removed?.queueId, 'a');
  assert.equal(bundle.queuedUserTurns.length, 1);
  bundle.queuedUserTurns.unshift(removed);
  assert.deepEqual(bundle.queuedUserTurns.map((item) => item.queueId), ['a', 'b']);
});

test('shiftNextQueuedUserTurn removes head item', () => {
  const bundle = createBundle({
    queuedUserTurns: [queuedItem('a', 1, 'one'), queuedItem('b', 2, 'two')],
  });
  const next = shiftNextQueuedUserTurn(bundle);
  assert.equal(next?.queueId, 'a');
  assert.equal(bundle.queuedUserTurns.length, 1);
  assert.equal(removeQueuedUserTurn(bundle, 'missing'), undefined);
  assert.equal(removeQueuedUserTurn(bundle, 'b')?.queueId, 'b');
  assert.equal(bundle.queuedUserTurns.length, 0);
});
