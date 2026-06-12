import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldPromptGitBranchCheckoutBeforeSend } from '../../src/lib/composer-branch-checkout-gate.ts';

const baseGit = {
  isRepository: true,
  workLocation: 'local',
  branch: 'main',
  selectedBranch: 'feature/foo',
};

test('prompts when empty session and selected branch differs from checked-out branch', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({ isEmptySession: true, git: baseGit }),
    true,
  );
});

test('does not prompt when session already has messages', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({ isEmptySession: false, git: baseGit }),
    false,
  );
});

test('does not prompt when not a git repository', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({
      isEmptySession: true,
      git: { ...baseGit, isRepository: false },
    }),
    false,
  );
});

test('does not prompt when work location is not local', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({
      isEmptySession: true,
      git: { ...baseGit, workLocation: 'remote' },
    }),
    false,
  );
});

test('does not prompt when selected branch matches checked-out branch', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({
      isEmptySession: true,
      git: { ...baseGit, selectedBranch: 'main' },
    }),
    false,
  );
});

test('does not prompt when git snapshot is missing', () => {
  assert.equal(
    shouldPromptGitBranchCheckoutBeforeSend({ isEmptySession: true, git: undefined }),
    false,
  );
});
