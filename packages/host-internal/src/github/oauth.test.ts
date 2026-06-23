import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchGitHubUserLogin, GitHubOAuthError } from './oauth.js';

const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

test('fetchGitHubUserLogin maps GitHub user response', async () => {
  mockFetch(async (_input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer gho_test_token');
    return Response.json({ login: 'octocat' });
  });

  try {
    const login = await fetchGitHubUserLogin('gho_test_token');
    assert.equal(login, 'octocat');
  } finally {
    restoreFetch();
  }
});

test('fetchGitHubUserLogin retries fetch failures until login is returned', async () => {
  let requestCount = 0;
  mockFetch(async () => {
    requestCount += 1;
    if (requestCount === 1) {
      throw new TypeError('fetch failed');
    }
    return Response.json({ login: 'octocat' });
  });

  try {
    const login = await fetchGitHubUserLogin('gho_test_token');
    assert.equal(login, 'octocat');
    assert.equal(requestCount, 2);
  } finally {
    restoreFetch();
  }
});

test('fetchGitHubUserLogin propagates non-retriable HTTP errors', async () => {
  mockFetch(async () => Response.json({ message: 'Bad credentials' }, { status: 401 }));

  try {
    await assert.rejects(
      () => fetchGitHubUserLogin('gho_test_token'),
      (error: unknown) => {
        assert.ok(error instanceof GitHubOAuthError);
        assert.match(error.message, /HTTP 401/iu);
        return true;
      },
    );
  } finally {
    restoreFetch();
  }
});
