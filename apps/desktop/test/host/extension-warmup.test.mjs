import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExtensionWarmupCoordinator } from '../../dist-electron/src/host/extension-warmup.js';

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createCallbacks(overrides = {}) {
  const calls = {
    collect: 0,
    refreshList: 0,
    dispatch: 0,
    apply: 0,
    emit: 0,
  };
  const callbacks = {
    async collectSystemPrompts() {
      calls.collect += 1;
      await delay(overrides.collectDelayMs ?? 0);
      return [{ extensionId: 'ext-1', extensionName: 'Test', content: 'prompt' }];
    },
    async refreshExtensionsListFull() {
      calls.refreshList += 1;
    },
    async dispatchEvent() {
      calls.dispatch += 1;
    },
    async applyWarmupToRuntime() {
      calls.apply += 1;
    },
    emitSnapshotUpdate() {
      calls.emit += 1;
    },
    ...overrides,
  };
  return { callbacks, calls };
}

test('ExtensionWarmupCoordinator reports loading while warmup is in flight', async () => {
  const coordinator = new ExtensionWarmupCoordinator();
  const { callbacks } = createCallbacks({ collectDelayMs: 30 });

  assert.equal(coordinator.extensionsLoading, false);
  coordinator.schedule({ type: 'startup', workspaceRoot: '/tmp/ws' }, callbacks);
  assert.equal(coordinator.extensionsLoading, true);

  await delay(80);
  assert.equal(coordinator.extensionsLoading, false);
  assert.equal(coordinator.warmupReady, true);
  assert.equal(coordinator.systemPromptsCache.length, 1);
});

test('ExtensionWarmupCoordinator skips stale warmup after invalidate', async () => {
  const coordinator = new ExtensionWarmupCoordinator();
  let resolveCollect;
  const collectGate = new Promise((resolve) => {
    resolveCollect = resolve;
  });
  const { callbacks, calls } = createCallbacks({
    async collectSystemPrompts() {
      calls.collect += 1;
      await collectGate;
      return [{ extensionId: 'ext-1', extensionName: 'Test', content: 'prompt' }];
    },
  });

  coordinator.schedule({ type: 'startup', workspaceRoot: '/tmp/ws' }, callbacks);
  coordinator.invalidate();
  resolveCollect();
  await delay(20);

  assert.equal(calls.refreshList, 0);
  assert.equal(calls.dispatch, 0);
  assert.equal(calls.apply, 0);
  assert.equal(coordinator.warmupReady, false);
  assert.equal(coordinator.systemPromptsCache.length, 0);
});

test('ExtensionWarmupCoordinator runs session trigger dispatch', async () => {
  const coordinator = new ExtensionWarmupCoordinator();
  const events = [];
  const { callbacks, calls } = createCallbacks({
    async dispatchEvent(event) {
      events.push(event);
      calls.dispatch += 1;
    },
  });

  coordinator.schedule(
    {
      type: 'session',
      event: {
        type: 'onSessionOpened',
        detail: { filePath: '/tmp/session.json', displayName: 'Session' },
      },
    },
    callbacks,
  );
  await delay(20);

  assert.equal(calls.apply, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'onSessionOpened');
});

test('refreshSystemPromptsCache updates cache synchronously for mutations', async () => {
  const coordinator = new ExtensionWarmupCoordinator();
  const { callbacks } = createCallbacks();

  await coordinator.refreshSystemPromptsCache(callbacks);
  assert.equal(coordinator.warmupReady, true);
  assert.equal(coordinator.systemPromptsCache[0]?.content, 'prompt');
});
