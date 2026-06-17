/**
 * In-process ACP authentication state for a single agent connection.
 *
 * Env-provided API keys or existing shared keyring/config credentials pre-authenticate
 * the process; first-time setup still uses Terminal Auth when no credentials exist.
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

/** Env API key or existing shared keyring/config credentials pre-authenticate the process. */
export function createAuthState(preAuthenticated = false): AuthState {
  return new AuthState(preAuthenticated);
}
