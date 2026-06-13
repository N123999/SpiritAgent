import type { GitHubAuthStatus, GitHubDeviceAuthChallenge } from "@/types";

export type GitHubDeviceLoginRuntime = {
  getGitHubAuthStatus: () => Promise<GitHubAuthStatus>;
  beginGitHubDeviceLogin: () => Promise<GitHubDeviceAuthChallenge>;
  completeGitHubDeviceLogin: () => Promise<GitHubAuthStatus>;
  cancelGitHubDeviceLogin: () => Promise<void>;
  disconnectGitHub: () => Promise<GitHubAuthStatus>;
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isGitHubDeviceAuthCancelledError(error: unknown): boolean {
  return /device authorization was cancel(?:l)?ed/i.test(describeError(error));
}

export type GitHubDeviceLoginModelState = {
  authStatus: GitHubAuthStatus;
  loadingAuth: boolean;
  deviceChallenge: GitHubDeviceAuthChallenge | null;
  error: string | null;
};

export class GitHubDeviceLoginModel {
  authStatus: GitHubAuthStatus = { connected: false };
  loadingAuth = false;
  deviceChallenge: GitHubDeviceAuthChallenge | null = null;
  error: string | null = null;
  private userCancelled = false;

  private readonly runtime: GitHubDeviceLoginRuntime;

  constructor(runtime: GitHubDeviceLoginRuntime) {
    this.runtime = runtime;
  }

  snapshot(): GitHubDeviceLoginModelState {
    return {
      authStatus: this.authStatus,
      loadingAuth: this.loadingAuth,
      deviceChallenge: this.deviceChallenge,
      error: this.error,
    };
  }

  async refreshAuthStatus(): Promise<void> {
    try {
      this.authStatus = await this.runtime.getGitHubAuthStatus();
    } catch (statusError) {
      this.error = describeError(statusError);
      this.authStatus = { connected: false };
    }
  }

  async startConnect(onStateChange?: () => void): Promise<GitHubAuthStatus | null> {
    const notify = () => {
      onStateChange?.();
    };
    this.loadingAuth = true;
    this.error = null;
    this.deviceChallenge = null;
    this.userCancelled = false;
    notify();
    try {
      const challenge = await this.runtime.beginGitHubDeviceLogin();
      this.deviceChallenge = challenge;
      notify();
      const next = await this.runtime.completeGitHubDeviceLogin();
      this.authStatus = next;
      notify();
      return next;
    } catch (connectError) {
      if (!this.userCancelled && !isGitHubDeviceAuthCancelledError(connectError)) {
        this.error = describeError(connectError);
        this.deviceChallenge = null;
      }
      notify();
      return null;
    } finally {
      this.loadingAuth = false;
      this.userCancelled = false;
      notify();
    }
  }

  async cancelConnect(): Promise<void> {
    this.userCancelled = true;
    this.error = null;
    try {
      await this.runtime.cancelGitHubDeviceLogin();
    } catch (cancelError) {
      this.error = describeError(cancelError);
    } finally {
      this.loadingAuth = false;
      this.deviceChallenge = null;
    }
  }

  async disconnect(): Promise<GitHubAuthStatus | null> {
    this.loadingAuth = true;
    this.error = null;
    try {
      const next = await this.runtime.disconnectGitHub();
      this.authStatus = next;
      return next;
    } catch (disconnectError) {
      this.error = describeError(disconnectError);
      return null;
    } finally {
      this.loadingAuth = false;
    }
  }
}
