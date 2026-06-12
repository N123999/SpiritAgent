import test from 'node:test';
import assert from 'node:assert/strict';

import { mapPullRequestDetail, mapPullRequestSummary } from './pull-request.js';

test('mapPullRequestSummary maps GitHub API payload', () => {
  const summary = mapPullRequestSummary({
    number: 42,
    title: 'Fix login bug',
    state: 'open',
    html_url: 'https://github.com/octocat/Hello-World/pull/42',
    draft: false,
    user: { login: 'octocat' },
    head: { ref: 'feature/login' },
    base: { ref: 'main' },
  });

  assert.deepEqual(summary, {
    number: 42,
    title: 'Fix login bug',
    state: 'open',
    url: 'https://github.com/octocat/Hello-World/pull/42',
    authorLogin: 'octocat',
    headRef: 'feature/login',
    baseRef: 'main',
    draft: false,
  });
});

test('mapPullRequestDetail includes labels and merge metadata', () => {
  const detail = mapPullRequestDetail({
    number: 7,
    title: 'Add tests',
    state: 'open',
    html_url: 'https://github.com/octocat/Hello-World/pull/7',
    body: 'Details here',
    draft: true,
    merged_at: null,
    mergeable: true,
    user: { login: 'hubot' },
    head: { ref: 'tests' },
    base: { ref: 'main' },
    labels: [{ name: 'enhancement' }, { name: 'ready' }],
  });

  assert.equal(detail.labels.join(','), 'enhancement,ready');
  assert.equal(detail.body, 'Details here');
  assert.equal(detail.mergeable, true);
  assert.equal(detail.merged, false);
  assert.equal(detail.draft, true);
});
