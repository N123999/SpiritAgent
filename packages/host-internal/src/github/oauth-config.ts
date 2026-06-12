export function resolveGitHubOAuthClientId(): string {
  return process.env.SPIRIT_GITHUB_OAUTH_CLIENT_ID?.trim() ?? '';
}

export const GITHUB_OAUTH_LOOPBACK_PORT = 53_682;

export const GITHUB_OAUTH_REDIRECT_URI = `http://127.0.0.1:${GITHUB_OAUTH_LOOPBACK_PORT}/callback`;

export const GITHUB_OAUTH_SCOPES = ['repo', 'read:user'] as const;

export const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export const GITHUB_OAUTH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
