import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import {
  cancelPendingWorktreeBootstrapOnBundle,
  shouldAdvanceWorktreeBootstrap,
  startWorktreeBootstrapTurnCommand,
} from '../../dist-electron/src/host/worktree-bootstrap-orchestrator.js';
import { WORKTREE_BOOTSTRAP_TOOL_NAME } from '../../dist-electron/src/host/worktree-bootstrap-card.js';

function createTimelineHarness() {
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });
  return { timeline, nextMessageId: () => nextMessageId };
}

test('cancelPendingWorktreeBootstrapOnBundle marks card failed and clears pending', async () => {
  const { timeline } = createTimelineHarness();
  const bundle = {
    id: 'draft-cancel',
    messages: [],
    messageTimeline: timeline,
    currentTurnSkills: [{ name: 'test' }],
    pendingWorktreeBootstrap: {
      toolCallId: 'worktree-bootstrap:draft-cancel',
      phase: 'running',
    },
  };
  timeline.beginUserTurn('hello', { messageId: 1 });
  cancelPendingWorktreeBootstrapOnBundle(bundle);
  assert.equal(bundle.pendingWorktreeBootstrap, undefined);
  assert.equal(bundle.currentTurnSkills.length, 0);
});

test('startWorktreeBootstrapTurnCommand inserts user message and running worktree card', async () => {
  const { timeline } = createTimelineHarness();
  const bundle = {
    id: 'draft-test',
    messages: [],
    messageTimeline: timeline,
    currentTurnSkills: [],
    rewindWarnings: [],
    pendingWorktreeBootstrap: undefined,
    activeSession: { readOnly: false },
  };

  let persisted = false;
  const snapshot = await startWorktreeBootstrapTurnCommand(
    {
      activeBundle: () => bundle,
      requireState: () => ({ workspaceRoot: '/repo' }),
      refreshRuntimeForBundle: async () => {},
      syncActiveRuntimePointer: () => {},
      clearAssistantContinuationMarkers: () => {},
      resolveTodoSessionKeyForBundle: () => 'todo-key',
      ensureActiveSession: () => {},
      reconcileTodoScopeAfterSessionPathChange: async () => {},
      maybeRefreshRuntimeAfterTodoScopeChange: async () => {},
      buildRewindCheckpointSnapshot: async () => ({
        archive: { llmHistory: [] },
        desktopMessages: [],
      }),
      allocateMessageId: () => 1,
      resetStreamingPlacementState: () => {},
      persistCurrentSessionIfNeeded: async () => {
        persisted = true;
      },
      scheduleSessionTitleGenerationIfNeeded: () => {},
      dispatchUserMessageExtensionEvent: async () => {},
      emitLiveSnapshotUpdate: () => {},
      buildSnapshot: () => ({ conversation: { messages: bundle.messages } }),
    },
    {
      validateWorktreeBootstrapPreconditions: () => {},
      executeWorktreeBootstrap: async () => {},
      resolveWorktreeBootstrapSessionKey: () => 'draft-test',
      setLastRuntimeError: () => {},
    },
    'build feature in worktree',
    {},
  );

  assert.equal(persisted, true);
  assert.equal(bundle.messages.length, 2);
  assert.equal(bundle.messages[0]?.role, 'user');
  assert.equal(bundle.messages[0]?.content, 'build feature in worktree');
  assert.equal(bundle.messages[1]?.tool?.toolName, WORKTREE_BOOTSTRAP_TOOL_NAME);
  assert.equal(bundle.messages[1]?.tool?.phase, 'running');
  assert.equal(bundle.pendingWorktreeBootstrap?.phase, 'running');
  assert.equal(shouldAdvanceWorktreeBootstrap(bundle), true);
  assert.ok(snapshot);
});
