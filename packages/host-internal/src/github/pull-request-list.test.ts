import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPullRequestSearchQuery, mapPullRequestListItem } from './pull-request-list.js';

test('buildPullRequestSearchQuery includes repo, pr type, state, and query', () => {
  assert.equal(
    buildPullRequestSearchQuery({ owner: 'octocat', repo: 'Hello-World' }, 'open', 'login bug'),
    'repo:octocat/Hello-World is:pr state:open login bug',
  );
});

test('buildPullRequestSearchQuery omits empty query token', () => {
  assert.equal(
    buildPullRequestSearchQuery({ owner: 'octocat', repo: 'Hello-World' }, 'closed', '   '),
    'repo:octocat/Hello-World is:pr state:closed',
  );
});

test('mapPullRequestListItem maps metadata and task list progress', () => {
  const item = mapPullRequestListItem({
    number: 42,
    title: 'Fix login bug',
    state: 'open',
    html_url: 'https://github.com/octocat/Hello-World/pull/42',
    draft: false,
    merged_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    body: '- [x] test one\n- [ ] test two',
    user: { login: 'octocat', avatar_url: 'https://avatars.example/octocat.png' },
    head: { ref: 'feature/login', sha: 'abc123' },
    base: { ref: 'main' },
  });

  assert.equal(item.number, 42);
  assert.equal(item.merged, false);
  assert.equal(item.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(item.updatedAt, '2026-01-02T00:00:00Z');
  assert.equal(item.authorAvatarUrl, 'https://avatars.example/octocat.png');
  assert.deepEqual(item.taskListProgress, { total: 2, completed: 1 });
});
