import { Agent, fetch as undiciFetch } from 'undici';

export type LlmHttpVersion = 'http1.1' | 'http2';

const LLM_HTTP_VERSIONS: readonly LlmHttpVersion[] = ['http1.1', 'http2'];

let configuredVersion: LlmHttpVersion = 'http2';
let llmDispatcher: Agent | undefined;

export function normalizeLlmHttpVersion(value: unknown): LlmHttpVersion {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'http1.1' || normalized === 'http/1.1' || normalized === 'http1') {
      return 'http1.1';
    }
    if (normalized === 'http2' || normalized === 'http/2' || normalized === 'h2') {
      return 'http2';
    }
  }
  return 'http2';
}

export function getLlmHttpVersion(): LlmHttpVersion {
  return configuredVersion;
}

export function configureLlmHttpVersion(version: LlmHttpVersion): void {
  const normalized = normalizeLlmHttpVersion(version);
  if (!LLM_HTTP_VERSIONS.includes(normalized)) {
    return;
  }
  if (configuredVersion === normalized && llmDispatcher !== undefined) {
    return;
  }
  configuredVersion = normalized;
  llmDispatcher = undefined;
}

function llmDispatcherInstance(): Agent {
  llmDispatcher ??= new Agent({
    allowH2: configuredVersion === 'http2',
    pipelining: 0,
  });
  return llmDispatcher;
}

/** LLM 出站请求：undici fetch；HTTP/2 由配置决定（TLS ALPN，对端不支持时回退 HTTP/1.1）。 */
export function getLlmFetch(): typeof fetch {
  const dispatcher = llmDispatcherInstance();
  const fetchWithDispatcher = (input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    );
  return fetchWithDispatcher as unknown as typeof fetch;
}
