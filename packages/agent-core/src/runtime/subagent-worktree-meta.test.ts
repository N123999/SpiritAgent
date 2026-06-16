import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatSubagentWorktreeMetaLine,
  prependSubagentWorktreeMeta,
} from './subagent-worktree-meta.js';

test('formatSubagentWorktreeMetaLine uses subagent_worktree_at tags', () => {
  const line = formatSubagentWorktreeMetaLine('/repo.worktrees/spirit-a', 'spirit/a');
  assert.equal(line, '<subagent_worktree_at>path=/repo.worktrees/spirit-a,branch=spirit/a</subagent_worktree_at>');
});

test('prependSubagentWorktreeMeta prepends meta line when path and branch provided', () => {
  const text = prependSubagentWorktreeMeta(
    '[subagent completed]\ntitle=Task',
    '/repo.worktrees/spirit-a',
    'spirit/a',
  );
  assert.ok(text.startsWith('<subagent_worktree_at>'));
  assert.ok(text.includes('[subagent completed]'));
});

test('prependSubagentWorktreeMeta leaves text unchanged without worktree fields', () => {
  const body = '[subagent completed]\ntitle=Task';
  assert.equal(prependSubagentWorktreeMeta(body), body);
});
