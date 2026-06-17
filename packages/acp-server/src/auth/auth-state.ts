/**
 * In-process ACP authentication state for a single agent connection.
 *
 * Env-provided API keys pre-authenticate the process; shared keyring/config
 * credentials require an explicit authenticate call (wired in Phase 4).
 */
export class AuthState {
  private authenticated: boolean;

  constructor(preAuthenticated = false) {
    this.authenticated = preAuthenticated;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  markAuthenticated(): void {
    this.authenticated = true;
  }

  logout(): void {
    this.authenticated = false;
  }
}

/** Env API key bypasses the authenticate handshake. */
export function createAuthState(hasEnvApiKey: boolean): AuthState {
  return new AuthState(hasEnvApiKey);
}
