/**
 * In-process ACP authentication state for a single agent connection.
 *
 * Existing shared keyring/config credentials pre-authenticate the process;
 * first-time setup uses Terminal Auth when no credentials exist.
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

/** Shared keyring/config credentials pre-authenticate the process when present. */
export function createAuthState(preAuthenticated = false): AuthState {
  return new AuthState(preAuthenticated);
}
