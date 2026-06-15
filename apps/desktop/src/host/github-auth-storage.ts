import {
  deleteKeyringPassword,
  getKeyringPassword,
  setKeyringPassword,
} from './keyring-secret.js';

const KEYRING_SERVICE = 'SpiritAgent';
const GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT = 'github::oauth_access_token';
const GITHUB_OAUTH_LOGIN_ACCOUNT = 'github::oauth_login';

export async function loadGitHubAccessToken(): Promise<string | undefined> {
  const value = getKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function loadGitHubLogin(): Promise<string | undefined> {
  const value = getKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_LOGIN_ACCOUNT);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function saveGitHubOAuthCredentials(input: {
  accessToken: string;
  login: string;
}): Promise<void> {
  setKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT, input.accessToken.trim());
  setKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_LOGIN_ACCOUNT, input.login.trim());
}

export async function clearGitHubOAuthCredentials(): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT);
  deleteKeyringPassword(KEYRING_SERVICE, GITHUB_OAUTH_LOGIN_ACCOUNT);
}

export async function getGitHubAuthStatusFromStorage(): Promise<{
  connected: boolean;
  login?: string;
}> {
  const accessToken = await loadGitHubAccessToken();
  if (!accessToken) {
    return { connected: false };
  }
  const login = await loadGitHubLogin();
  return login ? { connected: true, login } : { connected: true };
}
