import assert from 'node:assert/strict';
import { test } from 'node:test';

import { finishSessionActivationCommand } from '../../dist-electron/src/host/session-activation.js';

function createMinimalBundle(overrides = {}) {
  return {
    id: 'session-a',
    workspaceRoot: 'D:\\SpiritAgent.worktrees\\spirit-a',
    messages: [],
    messageTimeline: { toMessages: () => [] },
    runtime: undefined,
    runtimeActivationSignature: undefined,
    ...overrides,
  };
}

test('finishSessionActivationCommand syncs host workspace root before plan state', async () => {
  const calls = [];
  const bundle = createMinimalBundle();
  const ctx = {
    syncHostWorkspaceRootToActiveBundle: async (target) => {
      calls.push(['syncHostWorkspaceRootToActiveBundle', target.id]);
      return false;
    },
    syncPlanStateForBundle: async (target) => {
      calls.push(['syncPlanStateForBundle', target.id]);
    },
    resetStreamingPlacementState: () => {
      calls.push(['resetStreamingPlacementState']);
    },
    ensureToolExecutor: async () => {
      calls.push(['ensureToolExecutor']);
    },
    refreshTodoSnapshotForBundle: async () => {
      calls.push(['refreshTodoSnapshotForBundle']);
    },
    refreshRuntimeForBundle: async () => {
      calls.push(['refreshRuntimeForBundle']);
    },
    flushDeferredRuntimeRefreshIfIdle: async () => {
      calls.push(['flushDeferredRuntimeRefreshIfIdle']);
    },
    syncActiveRuntimePointer: () => {
      calls.push(['syncActiveRuntimePointer']);
    },
    requireState: () => ({
      config: { activeModel: 'test-model', models: [{ name: 'test-model' }] },
      workspaceRoot: 'D:\\SpiritAgent',
    }),
  };

  await finishSessionActivationCommand(ctx, bundle);

  assert.deepEqual(calls.slice(0, 2), [
    ['syncHostWorkspaceRootToActiveBundle', 'session-a'],
    ['syncPlanStateForBundle', 'session-a'],
  ]);
});

test('finishSessionActivationCommand still syncs host workspace root when runtime busy', async () => {
  const calls = [];
  const bundle = createMinimalBundle({
    runtime: { isBusy: () => true },
  });
  const ctx = {
    syncHostWorkspaceRootToActiveBundle: async (target) => {
      calls.push(['syncHostWorkspaceRootToActiveBundle', target.id]);
      return false;
    },
    syncPlanStateForBundle: async (target) => {
      calls.push(['syncPlanStateForBundle', target.id]);
    },
    tickSession: async () => {
      calls.push(['tickSession']);
    },
    syncActiveRuntimePointer: () => {
      calls.push(['syncActiveRuntimePointer']);
    },
    requireState: () => ({
      config: { activeModel: 'test-model', models: [{ name: 'test-model' }] },
      workspaceRoot: 'D:\\SpiritAgent',
    }),
  };

  await finishSessionActivationCommand(ctx, bundle);

  assert.deepEqual(calls, [
    ['syncHostWorkspaceRootToActiveBundle', 'session-a'],
    ['syncPlanStateForBundle', 'session-a'],
    ['tickSession'],
    ['syncActiveRuntimePointer'],
  ]);
});

test('finishSessionActivationCommand skips plan sync when host workspace root was adopted', async () => {
  const calls = [];
  const bundle = createMinimalBundle();
  const ctx = {
    syncHostWorkspaceRootToActiveBundle: async (target) => {
      calls.push(['syncHostWorkspaceRootToActiveBundle', target.id]);
      return true;
    },
    syncPlanStateForBundle: async (target) => {
      calls.push(['syncPlanStateForBundle', target.id]);
    },
    resetStreamingPlacementState: () => {
      calls.push(['resetStreamingPlacementState']);
    },
    ensureToolExecutor: async () => {
      calls.push(['ensureToolExecutor']);
    },
    refreshTodoSnapshotForBundle: async () => {
      calls.push(['refreshTodoSnapshotForBundle']);
    },
    refreshRuntimeForBundle: async () => {
      calls.push(['refreshRuntimeForBundle']);
    },
    flushDeferredRuntimeRefreshIfIdle: async () => {
      calls.push(['flushDeferredRuntimeRefreshIfIdle']);
    },
    syncActiveRuntimePointer: () => {
      calls.push(['syncActiveRuntimePointer']);
    },
    requireState: () => ({
      config: { activeModel: 'test-model', models: [{ name: 'test-model' }] },
      workspaceRoot: 'D:\\SpiritAgent.worktrees\\spirit-a',
    }),
  };

  await finishSessionActivationCommand(ctx, bundle);

  assert.equal(calls[0]?.[0], 'syncHostWorkspaceRootToActiveBundle');
  assert.equal(
    calls.filter((entry) => entry[0] === 'syncPlanStateForBundle').length,
    0,
  );
});
