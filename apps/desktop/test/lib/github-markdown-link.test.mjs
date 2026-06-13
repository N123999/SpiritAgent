import test from 'node:test';
import assert from 'node:assert/strict';

import { tryHandleGitHubPullRequestMarkdownLink } from '../../src/lib/github-markdown-link.ts';

test('tryHandleGitHubPullRequestMarkdownLink opens valid GitHub PR URLs', () => {
  const opened = [];
  const handled = tryHandleGitHubPullRequestMarkdownLink(
    'https://github.com/octocat/Hello-World/pull/42',
    (request) => opened.push(request),
  );

  assert.equal(handled, true);
  assert.deepEqual(opened, [{ owner: 'octocat', repo: 'Hello-World', number: 42 }]);
});

test('tryHandleGitHubPullRequestMarkdownLink ignores PR URLs when interceptInApp is false', () => {
  let called = false;
  const handled = tryHandleGitHubPullRequestMarkdownLink(
    'https://github.com/octocat/Hello-World/pull/42',
    () => {
      called = true;
    },
    { interceptInApp: false },
  );

  assert.equal(handled, false);
  assert.equal(called, false);
});

test('tryHandleGitHubPullRequestMarkdownLink ignores non-PR URLs', () => {
  let called = false;
  const handled = tryHandleGitHubPullRequestMarkdownLink(
    'https://github.com/octocat/Hello-World/issues/42',
    () => {
      called = true;
    },
  );

  assert.equal(handled, false);
  assert.equal(called, false);
});
