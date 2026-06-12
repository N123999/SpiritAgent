import {
  GITHUB_OAUTH_ACCESS_TOKEN_URL,
  GITHUB_OAUTH_DEVICE_CODE_URL,
  GITHUB_OAUTH_SCOPES,
} from './oauth-config.js';
import { GitHubOAuthError, requireGitHubOAuthClientId } from './oauth.js';
import type { GitHubDeviceAuthChallenge, GitHubOAuthTokenResponse } from './types.js';

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

interface DeviceCodeApiResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface DeviceTokenApiResponse extends GitHubOAuthTokenResponse {
  error?: string;
  error_description?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function requestGitHubDeviceCode(input?: {
  clientId?: string;
  scopes?: readonly string[];
}): Promise<GitHubDeviceAuthChallenge & { deviceCode: string }> {
  const body = new URLSearchParams({
    client_id: input?.clientId ?? requireGitHubOAuthClientId(),
    scope: (input?.scopes ?? GITHUB_OAUTH_SCOPES).join(' '),
  });

  const response = await fetch(GITHUB_OAUTH_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json()) as DeviceCodeApiResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || payload.error || !payload.device_code || !payload.user_code) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new GitHubOAuthError(`GitHub device code request failed: ${detail}`, response.status);
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    expiresIn: payload.expires_in,
    intervalSeconds: payload.interval,
  };
}

export async function pollGitHubDeviceToken(input: {
  deviceCode: string;
  intervalSeconds: number;
  expiresIn: number;
  clientId?: string;
  signal?: AbortSignal;
}): Promise<GitHubOAuthTokenResponse> {
  const startedAtMs = Date.now();
  const expiresAtMs = startedAtMs + input.expiresIn * 1000;
  let intervalMs = Math.max(1, input.intervalSeconds) * 1000;

  while (Date.now() < expiresAtMs) {
    if (input.signal?.aborted) {
      throw new GitHubOAuthError('GitHub device authorization was cancelled.');
    }

    const body = new URLSearchParams({
      client_id: input.clientId ?? requireGitHubOAuthClientId(),
      device_code: input.deviceCode,
      grant_type: DEVICE_GRANT_TYPE,
    });

    const response = await fetch(GITHUB_OAUTH_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      ...(input.signal ? { signal: input.signal } : {}),
    });

    const payload = (await response.json()) as DeviceTokenApiResponse;

    if (payload.access_token) {
      return {
        access_token: payload.access_token,
        token_type: payload.token_type,
        ...(payload.scope ? { scope: payload.scope } : {}),
      };
    }

    const error = payload.error?.trim();
    if (error === 'authorization_pending') {
      await sleep(intervalMs);
      continue;
    }

    if (error === 'slow_down') {
      intervalMs += 5000;
      await sleep(intervalMs);
      continue;
    }

    if (error === 'access_denied') {
      throw new GitHubOAuthError('GitHub device authorization was denied.');
    }

    if (error === 'expired_token') {
      throw new GitHubOAuthError('GitHub device code expired. Start sign-in again.');
    }

    const detail = payload.error_description ?? error ?? `HTTP ${response.status}`;
    throw new GitHubOAuthError(`GitHub device token exchange failed: ${detail}`, response.status);
  }

  throw new GitHubOAuthError('GitHub device authorization timed out.');
}
