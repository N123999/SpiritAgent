import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertGitHubPullRequestMergeMethod,
  mergePullRequest,
} from './pull-request-merge.js';

test('assertGitHubPullRequestMergeMethod accepts supported methods', () => {
  assert.equal(assertGitHubPullRequestMergeMethod('merge'), 'merge');
  assert.equal(assertGitHubPullRequestMergeMethod('squash'), 'squash');
  assert.equal(assertGitHubPullRequestMergeMethod('rebase'), 'rebase');
});

test('assertGitHubPullRequestMergeMethod rejects unsupported methods', () => {
  assert.throws(() => assertGitHubPullRequestMergeMethod('fast-forward'), /Unsupported/);
});

test('mergePullRequest sends merge_method in request body', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = '';
  globalThis.fetch = (async (_input, init) => {
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ sha: 'abc123', merged: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await mergePullRequest('token', { owner: 'octocat', repo: 'Hello-World' }, 42, {
      mergeMethod: 'squash',
    });
    assert.deepEqual(result, { sha: 'abc123', merged: true });
    assert.equal(JSON.parse(capturedBody).merge_method, 'squash');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
