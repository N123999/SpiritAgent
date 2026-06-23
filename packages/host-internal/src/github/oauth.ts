import { GITHUB_API_BASE_URL, resolveGitHubOAuthClientId } from './oauth-config.js';
import { githubFetch } from './github-fetch.js';
import {
  GITHUB_OAUTH_USER_LOOKUP_INTERVAL_MS,
  GITHUB_OAUTH_USER_LOOKUP_TIMEOUT_MS,
  isRetriableGitHubHttpStatus,
  retryGitHubOAuthUntil,
  type GitHubOAuthRetryAttempt,
} from './oauth-fetch-retry.js';

export class GitHubOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubOAuthError';
  }
}

export function requireGitHubOAuthClientId(): string {
  const clientId = resolveGitHubOAuthClientId();
  if (!clientId) {
    throw new GitHubOAuthError(
      'GitHub OAuth Client ID is not configured. Set SPIRIT_GITHUB_OAUTH_CLIENT_ID in apps/desktop/.env (see .env.example).',
    );
  }
  return clientId;
}

export async function fetchGitHubUserLogin(accessToken: string): Promise<string> {
  return retryGitHubOAuthUntil({
    expiresAtMs: Date.now() + GITHUB_OAUTH_USER_LOOKUP_TIMEOUT_MS,
    intervalMs: GITHUB_OAUTH_USER_LOOKUP_INTERVAL_MS,
    timedOutMessage: 'GitHub user lookup timed out.',
    attempt: async (): Promise<GitHubOAuthRetryAttempt<string>> => {
      try {
        const response = await githubFetch(`${GITHUB_API_BASE_URL}/user`, {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });

        if (isRetriableGitHubHttpStatus(response.status)) {
          return { outcome: 'retry' };
        }

        if (!response.ok) {
          throw new GitHubOAuthError(`GitHub user lookup failed: HTTP ${response.status}`, response.status);
        }

        const payload = (await response.json()) as { login?: string };
        const login = payload.login?.trim();
        if (!login) {
          throw new GitHubOAuthError('GitHub user lookup returned no login.');
        }
        return { outcome: 'success', value: login };
      } catch (error) {
        if (error instanceof GitHubOAuthError) {
          throw error;
        }
        return { outcome: 'retry' };
      }
    },
  });
}
