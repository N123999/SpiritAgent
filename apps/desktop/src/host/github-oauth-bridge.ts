import type { GitHubDeviceAuthChallenge } from '@spirit-agent/host-internal';

export type BeginGitHubDeviceLoginRunner = () => Promise<GitHubDeviceAuthChallenge>;
export type CompleteGitHubDeviceLoginRunner = () => Promise<{ login: string }>;
export type CancelGitHubDeviceLoginRunner = () => void;

let beginRunner: BeginGitHubDeviceLoginRunner | null = null;
let completeRunner: CompleteGitHubDeviceLoginRunner | null = null;
let cancelRunner: CancelGitHubDeviceLoginRunner | null = null;

export function registerGitHubDeviceLoginRunners(runners: {
  begin: BeginGitHubDeviceLoginRunner;
  complete: CompleteGitHubDeviceLoginRunner;
  cancel: CancelGitHubDeviceLoginRunner;
}): void {
  beginRunner = runners.begin;
  completeRunner = runners.complete;
  cancelRunner = runners.cancel;
}

export async function beginGitHubDeviceLogin(): Promise<GitHubDeviceAuthChallenge> {
  if (!beginRunner) {
    throw new Error('GitHub device login is only available in the Electron desktop app.');
  }
  return beginRunner();
}

export async function completeGitHubDeviceLogin(): Promise<{ login: string }> {
  if (!completeRunner) {
    throw new Error('GitHub device login is only available in the Electron desktop app.');
  }
  return completeRunner();
}

export function cancelGitHubDeviceLogin(): void {
  cancelRunner?.();
}
