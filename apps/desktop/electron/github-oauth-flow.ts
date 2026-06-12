import { shell } from 'electron';
import {
  fetchGitHubUserLogin,
  GitHubOAuthError,
  pollGitHubDeviceToken,
  requestGitHubDeviceCode,
  type GitHubDeviceAuthChallenge,
} from '@spirit-agent/host-internal';

import { saveGitHubOAuthCredentials } from '../src/host/github-auth-storage.js';

interface PendingDeviceAuth {
  deviceCode: string;
  intervalSeconds: number;
  expiresIn: number;
  expiresAtMs: number;
  abortController: AbortController;
}

let pendingDeviceAuth: PendingDeviceAuth | null = null;

export function clearPendingGitHubDeviceAuth(): void {
  pendingDeviceAuth?.abortController.abort();
  pendingDeviceAuth = null;
}

export async function beginGitHubDeviceLoginInElectron(): Promise<GitHubDeviceAuthChallenge> {
  clearPendingGitHubDeviceAuth();
  const abortController = new AbortController();
  const challenge = await requestGitHubDeviceCode();
  pendingDeviceAuth = {
    deviceCode: challenge.deviceCode,
    intervalSeconds: challenge.intervalSeconds,
    expiresIn: challenge.expiresIn,
    expiresAtMs: Date.now() + challenge.expiresIn * 1000,
    abortController,
  };
  await shell.openExternal(challenge.verificationUri);
  return {
    userCode: challenge.userCode,
    verificationUri: challenge.verificationUri,
    expiresIn: challenge.expiresIn,
    intervalSeconds: challenge.intervalSeconds,
  };
}

export async function completeGitHubDeviceLoginInElectron(): Promise<{ login: string }> {
  const pending = pendingDeviceAuth;
  if (!pending) {
    throw new Error('GitHub device sign-in has not started. Call beginGitHubDeviceLogin first.');
  }

  const remainingSeconds = Math.max(1, Math.ceil((pending.expiresAtMs - Date.now()) / 1000));
  try {
    const token = await pollGitHubDeviceToken({
      deviceCode: pending.deviceCode,
      intervalSeconds: pending.intervalSeconds,
      expiresIn: remainingSeconds,
      signal: pending.abortController.signal,
    });
    const login = await fetchGitHubUserLogin(token.access_token);
    await saveGitHubOAuthCredentials({
      accessToken: token.access_token,
      login,
    });
    return { login };
  } catch (error) {
    if (pending.abortController.signal.aborted) {
      throw new GitHubOAuthError('GitHub device authorization was cancelled.');
    }
    throw error;
  } finally {
    clearPendingGitHubDeviceAuth();
  }
}
