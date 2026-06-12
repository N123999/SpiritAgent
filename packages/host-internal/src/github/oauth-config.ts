export function resolveGitHubOAuthClientId(): string {
  return process.env.SPIRIT_GITHUB_OAUTH_CLIENT_ID?.trim() ?? '';
}

export const GITHUB_OAUTH_SCOPES = ['repo', 'read:user'] as const;

export const GITHUB_OAUTH_DEVICE_CODE_URL = 'https://github.com/login/device/code';

export const GITHUB_OAUTH_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export const GITHUB_API_BASE_URL = 'https://api.github.com';
