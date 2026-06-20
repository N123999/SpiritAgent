import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  needsHostWorkspaceRootSync,
  resolveEffectiveWorkspaceRoot,
} from '../../dist-electron/src/host/workspace-root-sync.js';

test('resolveEffectiveWorkspaceRoot prefers bundle workspaceRoot', () => {
  assert.equal(
    resolveEffectiveWorkspaceRoot(
      { workspaceRoot: 'D:\\SpiritAgent.worktrees\\spirit-a' },
      { workspaceRoot: 'D:\\SpiritAgent' },
    ),
    'D:\\SpiritAgent.worktrees\\spirit-a',
  );
});

test('resolveEffectiveWorkspaceRoot falls back to host state when bundle empty', () => {
  assert.equal(
    resolveEffectiveWorkspaceRoot({ workspaceRoot: '' }, { workspaceRoot: 'D:\\SpiritAgent' }),
    'D:\\SpiritAgent',
  );
});

test('needsHostWorkspaceRootSync is true when bundle worktree differs from host primary repo', () => {
  assert.equal(
    needsHostWorkspaceRootSync(
      { workspaceRoot: 'D:\\SpiritAgent.worktrees\\spirit-a' },
      { workspaceRoot: 'D:\\SpiritAgent' },
    ),
    true,
  );
});

test('needsHostWorkspaceRootSync is false when paths match case-insensitively', () => {
  assert.equal(
    needsHostWorkspaceRootSync(
      { workspaceRoot: 'd:/spiritagent.worktrees/spirit-a' },
      { workspaceRoot: 'D:\\SpiritAgent.worktrees\\spirit-a' },
    ),
    false,
  );
});

test('needsHostWorkspaceRootSync is false when both use primary repo', () => {
  assert.equal(
    needsHostWorkspaceRootSync(
      { workspaceRoot: 'D:\\SpiritAgent' },
      { workspaceRoot: 'D:\\SpiritAgent' },
    ),
    false,
  );
});
