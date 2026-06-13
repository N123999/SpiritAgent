import test from 'node:test';
import assert from 'node:assert/strict';

import { markPullRequestReadyForReview } from './pull-request-ready.js';

test('markPullRequestReadyForReview sends GraphQL mutation with node id', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = '';
  globalThis.fetch = (async (_input, init) => {
    capturedBody = String(init?.body ?? '');
    return new Response(
      JSON.stringify({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { id: 'PR_kwDOA', isDraft: false },
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as typeof fetch;

  try {
    await markPullRequestReadyForReview('token', 'PR_kwDOA');
    const payload = JSON.parse(capturedBody) as {
      query: string;
      variables: { pullRequestId: string };
    };
    assert.match(payload.query, /markPullRequestReadyForReview/);
    assert.equal(payload.variables.pullRequestId, 'PR_kwDOA');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('markPullRequestReadyForReview rejects when pull request remains draft', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { id: 'PR_kwDOA', isDraft: true },
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )) as typeof fetch;

  try {
    await assert.rejects(
      () => markPullRequestReadyForReview('token', 'PR_kwDOA'),
      /still a draft/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('markPullRequestReadyForReview rejects empty node id', async () => {
  await assert.rejects(() => markPullRequestReadyForReview('token', ''), /node ID is required/);
});
