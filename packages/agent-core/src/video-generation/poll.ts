export interface PollOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_INITIAL_DELAY_MS = 3_000;
const DEFAULT_MAX_DELAY_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export async function pollUntil<T>(
  poll: () => Promise<T | undefined>,
  options: PollOptions = {},
): Promise<T> {
  const startedAt = Date.now();
  let delayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  while (true) {
    if (options.signal?.aborted) {
      throw new Error('Video generation polling was aborted.');
    }

    const result = await poll();
    if (result !== undefined) {
      return result;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Video generation timed out while waiting for provider completion.');
    }

    await sleep(delayMs, options.signal);
    delayMs = Math.min(Math.round(delayMs * 1.5), maxDelayMs);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error('Video generation polling was aborted.'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new Error('Video generation polling was aborted.'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
