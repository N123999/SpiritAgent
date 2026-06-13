import test from 'node:test';
import assert from 'node:assert/strict';

import { mapPullRequestCommit, mapPullRequestCommits } from './pull-request-commits.js';

test('mapPullRequestCommit maps GitHub API payload', () => {
  const commit = mapPullRequestCommit({
    sha: 'abc123',
    html_url: 'https://github.com/octocat/Hello-World/commit/abc123',
    commit: {
      message: 'feat(auth): add session refresh\n\nBody paragraph.',
      author: {
        name: 'Octocat',
        date: '2026-06-01T12:00:00Z',
      },
    },
    author: {
      login: 'octocat',
      avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
    },
  });

  assert.deepEqual(commit, {
    sha: 'abc123',
    subject: 'feat(auth): add session refresh',
    authorLogin: 'octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    createdAt: '2026-06-01T12:00:00Z',
    url: 'https://github.com/octocat/Hello-World/commit/abc123',
  });
});

test('mapPullRequestCommit falls back to commit author name when GitHub user is missing', () => {
  const commit = mapPullRequestCommit({
    sha: 'def456',
    commit: {
      message: 'fix: handle edge case',
      author: {
        name: 'octocat',
        date: '2026-06-02T08:30:00Z',
      },
    },
    author: null,
  });

  assert.equal(commit?.authorLogin, 'octocat');
  assert.equal(commit?.avatarUrl, 'https://github.com/octocat.png?size=40');
});

test('mapPullRequestCommit uses placeholder subject for empty message', () => {
  const commit = mapPullRequestCommit({
    sha: 'empty1',
    commit: {
      message: '   ',
      author: { name: 'Bot', date: '2026-06-03T00:00:00Z' },
    },
  });

  assert.equal(commit?.subject, '(no message)');
});

test('mapPullRequestCommits skips invalid entries', () => {
  const commits = mapPullRequestCommits([
    {
      sha: 'valid',
      commit: {
        message: 'chore: bump deps',
        author: { name: 'Dev', date: '2026-06-04T00:00:00Z' },
      },
    },
    { sha: '  ', commit: { message: 'skip me', author: { name: 'Dev', date: '2026-06-04T00:00:00Z' } } },
  ]);

  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.sha, 'valid');
});
