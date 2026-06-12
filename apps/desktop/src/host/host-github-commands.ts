import type { GitHubAuthStatus } from '@spirit-agent/host-internal';

import {
  clearGitHubOAuthCredentials,
  getGitHubAuthStatusFromStorage,
} from './github-auth-storage.js';
import { runGitHubOAuthFlow } from './github-oauth-bridge.js';

export async function getGitHubAuthStatusCommand(): Promise<GitHubAuthStatus> {
  return getGitHubAuthStatusFromStorage();
}

export async function startGitHubOAuthCommand(): Promise<GitHubAuthStatus> {
  const result = await runGitHubOAuthFlow();
  return {
    connected: true,
    login: result.login,
  };
}

export async function disconnectGitHubCommand(): Promise<GitHubAuthStatus> {
  await clearGitHubOAuthCredentials();
  return { connected: false };
}
