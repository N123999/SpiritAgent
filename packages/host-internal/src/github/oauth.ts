import { GITHUB_API_BASE_URL, resolveGitHubOAuthClientId } from './oauth-config.js';

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
  const response = await fetch(`${GITHUB_API_BASE_URL}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new GitHubOAuthError(`GitHub user lookup failed: HTTP ${response.status}`, response.status);
  }

  const payload = (await response.json()) as { login?: string };
  const login = payload.login?.trim();
  if (!login) {
    throw new GitHubOAuthError('GitHub user lookup returned no login.');
  }
  return login;
}
