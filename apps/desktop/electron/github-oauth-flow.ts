import { randomBytes } from 'node:crypto';

import { shell } from 'electron';
import {
  buildGitHubAuthorizeUrl,
  exchangeGitHubCodeForToken,
  fetchGitHubUserLogin,
  generatePkcePair,
} from '@spirit-agent/host-internal';

import { saveGitHubOAuthCredentials } from '../src/host/github-auth-storage.js';
import { waitForGitHubOAuthCallback } from './github-oauth-loopback.js';

function createOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export async function runGitHubOAuthFlowInElectron(): Promise<{ login: string }> {
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = createOAuthState();
  const authorizeUrl = buildGitHubAuthorizeUrl({
    state,
    codeChallenge,
  });

  const callbackPromise = waitForGitHubOAuthCallback(state);
  await shell.openExternal(authorizeUrl);
  const callback = await callbackPromise;

  const token = await exchangeGitHubCodeForToken({
    code: callback.code,
    codeVerifier,
  });
  const login = await fetchGitHubUserLogin(token.access_token);
  await saveGitHubOAuthCredentials({
    accessToken: token.access_token,
    login,
  });
  return { login };
}
