import { resolveEnvApiKey } from '../config.js';
import { hasResolvableCredentials } from '../credentials/index.js';
import type { AcpServerConfig } from '../types.js';
import { AuthState } from './auth-state.js';

export function isEnvPreAuthenticated(): boolean {
  return resolveEnvApiKey() !== undefined;
}

export function shouldPreAuthenticateFromSharedConfig(spiritDataDir: string): boolean {
  return hasResolvableCredentials(spiritDataDir);
}

export function createInitialAuthState(config: AcpServerConfig): AuthState {
  const preAuthenticated =
    isEnvPreAuthenticated() || shouldPreAuthenticateFromSharedConfig(config.spiritDataDir);
  return new AuthState(preAuthenticated);
}

export function shouldAdvertiseAuthMethods(spiritDataDir: string): boolean {
  if (isEnvPreAuthenticated()) {
    return false;
  }
  return !shouldPreAuthenticateFromSharedConfig(spiritDataDir);
}

export function canCreateSession(config: AcpServerConfig, authState: AuthState): boolean {
  if (isEnvPreAuthenticated()) {
    return true;
  }
  if (!authState.isAuthenticated()) {
    return false;
  }
  return hasResolvableCredentials(config.spiritDataDir);
}
