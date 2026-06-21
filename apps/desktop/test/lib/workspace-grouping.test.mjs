import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSpiritWorktreeWorkspaceRoot,
  resolveSessionWorkLocation,
  resolveWorkspaceGroupingRoot,
} from '../../src/lib/workspace-grouping.ts';

test('resolveWorkspaceGroupingRoot maps linked worktrees to primary repo', () => {
  assert.equal(
    resolveWorkspaceGroupingRoot('D:\\SpiritAgent.worktrees\\spirit-hello-test'),
    'D:/SpiritAgent',
  );
  assert.equal(
    resolveWorkspaceGroupingRoot('/Users/dev/SpiritAgent.worktrees/spirit-a'),
    '/Users/dev/SpiritAgent',
  );
});

test('resolveWorkspaceGroupingRoot returns local repo path unchanged', () => {
  assert.equal(resolveWorkspaceGroupingRoot('D:\\SpiritAgent'), 'D:/SpiritAgent');
  assert.equal(
    resolveWorkspaceGroupingRoot('/Users/dev/SpiritAgent/'),
    '/Users/dev/SpiritAgent',
  );
});

test('isSpiritWorktreeWorkspaceRoot detects spirit worktree paths', () => {
  assert.equal(
    isSpiritWorktreeWorkspaceRoot('D:\\SpiritAgent.worktrees\\spirit-a'),
    true,
  );
  assert.equal(
    isSpiritWorktreeWorkspaceRoot('d:/spiritagent.worktrees/spirit-a'),
    true,
  );
  assert.equal(
    isSpiritWorktreeWorkspaceRoot('/Users/dev/SpiritAgent.worktrees/spirit-a/'),
    true,
  );
});

test('isSpiritWorktreeWorkspaceRoot rejects primary repo and unrelated paths', () => {
  assert.equal(isSpiritWorktreeWorkspaceRoot('D:\\SpiritAgent'), false);
  assert.equal(isSpiritWorktreeWorkspaceRoot('/Users/dev/SpiritAgent'), false);
  assert.equal(isSpiritWorktreeWorkspaceRoot('/tmp/foo/bar'), false);
});

test('resolveSessionWorkLocation maps path to local or worktree', () => {
  assert.equal(resolveSessionWorkLocation('D:\\SpiritAgent'), 'local');
  assert.equal(
    resolveSessionWorkLocation('D:\\SpiritAgent.worktrees\\spirit-a'),
    'worktree',
  );
});
