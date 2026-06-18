import assert from 'node:assert/strict';
import test from 'node:test';

import { isSessionBundleBusy } from '../../dist-electron/src/host/direct-media-turn.js';
import {
  buildWorktreeBootstrapToolSnapshot,
  isWorktreeBootstrapInFlight,
  worktreeBootstrapToolCallId,
  WORKTREE_BOOTSTRAP_TOOL_NAME,
} from '../../dist-electron/src/host/worktree-bootstrap-card.js';
import { toolCallPhaseShowsShimmer } from '../../dist-electron/src/lib/tool-call-shimmer.js';
import i18n from '../../dist-electron/src/lib/i18n-host.js';

test('worktreeBootstrapToolCallId is stable per session key', () => {
  assert.equal(worktreeBootstrapToolCallId('draft-1'), 'worktree-bootstrap:draft-1');
});

test('buildWorktreeBootstrapToolSnapshot uses create verb and Worktree detail', async () => {
  await i18n.changeLanguage('en');
  const running = buildWorktreeBootstrapToolSnapshot('running');
  assert.equal(running.toolName, WORKTREE_BOOTSTRAP_TOOL_NAME);
  assert.equal(running.phase, 'running');
  assert.equal(running.headline, 'Creating');
  assert.equal(running.headlineDetail, 'Worktree');
  assert.equal(toolCallPhaseShowsShimmer(running.phase), true);

  const succeeded = buildWorktreeBootstrapToolSnapshot('succeeded');
  assert.equal(succeeded.headline, 'Created');
  assert.equal(toolCallPhaseShowsShimmer(succeeded.phase), false);
  assert.equal(succeeded.headlineDetail, 'Worktree');
});

test('buildWorktreeBootstrapToolSnapshot zh-CN progressive verbs', async () => {
  await i18n.changeLanguage('zh-CN');
  const running = buildWorktreeBootstrapToolSnapshot('running');
  assert.equal(running.headline, '创建中');
  const succeeded = buildWorktreeBootstrapToolSnapshot('succeeded');
  assert.equal(succeeded.headline, '已创建');
});

test('isWorktreeBootstrapInFlight and isSessionBundleBusy', () => {
  assert.equal(isWorktreeBootstrapInFlight(undefined), false);
  assert.equal(
    isWorktreeBootstrapInFlight({ phase: 'running' }),
    true,
  );
  assert.equal(
    isWorktreeBootstrapInFlight({ phase: 'succeeded' }),
    false,
  );

  assert.equal(
    isSessionBundleBusy({
      pendingWorktreeBootstrap: { phase: 'running' },
    }),
    true,
  );
  assert.equal(
    isSessionBundleBusy({
      pendingWorktreeBootstrap: { phase: 'failed' },
      runtime: { isBusy: () => false },
    }),
    false,
  );
});
