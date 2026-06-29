import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGitHubPullRequestUrl } from './pull-request-url.js';

test('parseGitHubPullRequestUrl parses canonical pull request URLs', () => {
  assert.deepEqual(parseGitHubPullRequestUrl('https://github.com/SpiritAgents/SpiritAgent/pull/100'), {
    owner: 'SpiritAgents',
    repo: 'SpiritAgent',
    number: 100,
  });
});

test('parseGitHubPullRequestUrl ignores trailing segments and hash', () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl('https://github.com/octocat/Hello-World/pull/42/files#diff-1'),
    {
      owner: 'octocat',
      repo: 'Hello-World',
      number: 42,
    },
  );
});

test('parseGitHubPullRequestUrl rejects non-github and non-pull URLs', () => {
  assert.equal(parseGitHubPullRequestUrl('https://gitlab.com/group/project/pull/1'), null);
  assert.equal(parseGitHubPullRequestUrl('https://github.com/octocat/Hello-World/issues/42'), null);
  assert.equal(parseGitHubPullRequestUrl('https://github.com/octocat/Hello-World/pull/'), null);
  assert.equal(parseGitHubPullRequestUrl(''), null);
});
