import { GitHubOAuthError } from './oauth.js';

export const GITHUB_OAUTH_DEVICE_CODE_REQUEST_TIMEOUT_MS = 60_000;
export const GITHUB_OAUTH_DEVICE_CODE_REQUEST_INTERVAL_MS = 2_000;
export const GITHUB_OAUTH_USER_LOOKUP_TIMEOUT_MS = 60_000;
export const GITHUB_OAUTH_USER_LOOKUP_INTERVAL_MS = 2_000;

export function isRetriableGitHubHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isGitHubFetchAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return true;
  }
  return error instanceof DOMException && error.name === 'AbortError';
}

export function throwIfGitHubFetchAborted(
  signal: AbortSignal | undefined,
  message = 'GitHub device authorization was cancelled.',
): void {
  if (signal?.aborted) {
    throw new GitHubOAuthError(message);
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function sleepUntilGitHubOAuthRetryDeadline(input: {
  intervalMs: number;
  expiresAtMs: number;
  signal?: AbortSignal;
  cancelledMessage?: string;
}): Promise<void> {
  throwIfGitHubFetchAborted(input.signal, input.cancelledMessage);
  const remainingMs = input.expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    return;
  }
  await sleepMs(Math.min(input.intervalMs, remainingMs));
}

export type GitHubOAuthRetryAttempt<T> =
  | { outcome: 'success'; value: T }
  | { outcome: 'retry' };

export async function retryGitHubOAuthUntil<T>(input: {
  expiresAtMs: number;
  intervalMs: number;
  signal?: AbortSignal;
  cancelledMessage?: string;
  timedOutMessage: string;
  attempt: () => Promise<GitHubOAuthRetryAttempt<T>>;
}): Promise<T> {
  while (Date.now() < input.expiresAtMs) {
    throwIfGitHubFetchAborted(input.signal, input.cancelledMessage);
    try {
      const result = await input.attempt();
      if (result.outcome === 'success') {
        return result.value;
      }
    } catch (error) {
      if (error instanceof GitHubOAuthError) {
        throw error;
      }
      if (isGitHubFetchAbortError(error, input.signal)) {
        throw new GitHubOAuthError(
          input.cancelledMessage ?? 'GitHub device authorization was cancelled.',
        );
      }
    }
    await sleepUntilGitHubOAuthRetryDeadline({
      intervalMs: input.intervalMs,
      expiresAtMs: input.expiresAtMs,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.cancelledMessage ? { cancelledMessage: input.cancelledMessage } : {}),
    });
  }
  throw new GitHubOAuthError(input.timedOutMessage);
}
