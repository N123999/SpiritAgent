import { Entry } from '@napi-rs/keyring';

const KEYRING_SERVICE = 'SpiritAgent';
const GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT = 'github::oauth_access_token';
const GITHUB_OAUTH_LOGIN_ACCOUNT = 'github::oauth_login';

export async function loadGitHubAccessToken(): Promise<string | undefined> {
  try {
    const value = new Entry(KEYRING_SERVICE, GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT).getPassword();
    const trimmed = value?.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function loadGitHubLogin(): Promise<string | undefined> {
  try {
    const value = new Entry(KEYRING_SERVICE, GITHUB_OAUTH_LOGIN_ACCOUNT).getPassword();
    const trimmed = value?.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function saveGitHubOAuthCredentials(input: {
  accessToken: string;
  login: string;
}): Promise<void> {
  new Entry(KEYRING_SERVICE, GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT).setPassword(input.accessToken.trim());
  new Entry(KEYRING_SERVICE, GITHUB_OAUTH_LOGIN_ACCOUNT).setPassword(input.login.trim());
}

export async function clearGitHubOAuthCredentials(): Promise<void> {
  for (const account of [GITHUB_OAUTH_ACCESS_TOKEN_ACCOUNT, GITHUB_OAUTH_LOGIN_ACCOUNT]) {
    try {
      new Entry(KEYRING_SERVICE, account).deletePassword();
    } catch {
      /* align with other keyring delete behavior */
    }
  }
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
