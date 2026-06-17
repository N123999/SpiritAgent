import { hasResolvableCredentials } from '../credentials/index.js';
import type { AcpServerConfig } from '../types.js';
import { AuthState } from './auth-state.js';

export function shouldPreAuthenticateFromSharedConfig(spiritDataDir: string): boolean {
  return hasResolvableCredentials(spiritDataDir);
}

export function createInitialAuthState(config: AcpServerConfig): AuthState {
  return new AuthState(shouldPreAuthenticateFromSharedConfig(config.spiritDataDir));
}

export function canCreateSession(config: AcpServerConfig, authState: AuthState): boolean {
  if (!authState.isAuthenticated()) {
    return false;
  }
  return hasResolvableCredentials(config.spiritDataDir);
}
