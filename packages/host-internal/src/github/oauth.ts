import {
  GITHUB_API_BASE_URL,
  GITHUB_OAUTH_ACCESS_TOKEN_URL,
  GITHUB_OAUTH_AUTHORIZE_URL,
  GITHUB_OAUTH_REDIRECT_URI,
  GITHUB_OAUTH_SCOPES,
  resolveGitHubOAuthClientId,
} from './oauth-config.js';
import type { GitHubOAuthTokenResponse } from './types.js';

export interface BuildGitHubAuthorizeUrlInput {
  clientId?: string;
  redirectUri?: string;
  scopes?: readonly string[];
  state: string;
  codeChallenge: string;
}

export interface ExchangeGitHubCodeInput {
  code: string;
  codeVerifier: string;
  clientId?: string;
  redirectUri?: string;
}

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

export function buildGitHubAuthorizeUrl(input: BuildGitHubAuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId ?? requireGitHubOAuthClientId(),
    redirect_uri: input.redirectUri ?? GITHUB_OAUTH_REDIRECT_URI,
    scope: (input.scopes ?? GITHUB_OAUTH_SCOPES).join(' '),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${GITHUB_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGitHubCodeForToken(
  input: ExchangeGitHubCodeInput,
): Promise<GitHubOAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: input.clientId ?? requireGitHubOAuthClientId(),
    redirect_uri: input.redirectUri ?? GITHUB_OAUTH_REDIRECT_URI,
    code: input.code,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(GITHUB_OAUTH_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json()) as GitHubOAuthTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || payload.error || !payload.access_token) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new GitHubOAuthError(`GitHub OAuth token exchange failed: ${detail}`, response.status);
  }

  return {
    access_token: payload.access_token,
    token_type: payload.token_type,
    ...(payload.scope ? { scope: payload.scope } : {}),
  };
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
