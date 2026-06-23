import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRetriableGitHubHttpStatus,
  retryGitHubOAuthUntil,
} from './oauth-fetch-retry.js';
import { GitHubOAuthError } from './oauth.js';

test('isRetriableGitHubHttpStatus covers transient server errors', () => {
  assert.equal(isRetriableGitHubHttpStatus(502), true);
  assert.equal(isRetriableGitHubHttpStatus(400), false);
});

test('retryGitHubOAuthUntil retries transient failures until success', async () => {
  let attempts = 0;
  const value = await retryGitHubOAuthUntil({
    expiresAtMs: Date.now() + 5_000,
    intervalMs: 0,
    timedOutMessage: 'timed out',
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError('fetch failed');
      }
      return { outcome: 'success', value: 'ok' };
    },
  });

  assert.equal(value, 'ok');
  assert.equal(attempts, 2);
});

test('retryGitHubOAuthUntil propagates GitHubOAuthError without retry', async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      retryGitHubOAuthUntil({
        expiresAtMs: Date.now() + 5_000,
        intervalMs: 0,
        timedOutMessage: 'timed out',
        attempt: async () => {
          attempts += 1;
          throw new GitHubOAuthError('denied');
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubOAuthError);
      assert.match(error.message, /denied/iu);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test('retryGitHubOAuthUntil throws when deadline passes', async () => {
  await assert.rejects(
    () =>
      retryGitHubOAuthUntil({
        expiresAtMs: Date.now() + 20,
        intervalMs: 0,
        timedOutMessage: 'request timed out',
        attempt: async () => ({ outcome: 'retry' }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof GitHubOAuthError);
      assert.match(error.message, /timed out/iu);
      return true;
    },
  );
});
