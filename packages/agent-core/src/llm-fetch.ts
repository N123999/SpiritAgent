import { createRequire } from 'node:module';

import { Agent, fetch as undiciFetch } from 'undici';

export type LlmHttpVersion = 'http1.1' | 'http2';

export const SPIRIT_AGENT_UA_PRODUCT = 'SpiritAgent';

const require = createRequire(import.meta.url);
const defaultClientVersion = (require('../package.json') as { version: string }).version;

const LLM_HTTP_VERSIONS: readonly LlmHttpVersion[] = ['http1.1', 'http2'];

let configuredVersion: LlmHttpVersion = 'http2';
let llmDispatcher: Agent | undefined;
let configuredClientVersion: string = defaultClientVersion;
let llmFetchTransportOverride: typeof fetch | undefined;

/** @internal Unit tests may replace the underlying transport after UA merge. */
export function setLlmFetchTransportOverrideForTests(fetchImpl: typeof fetch | undefined): void {
  llmFetchTransportOverride = fetchImpl;
}

export function buildSpiritAgentUserAgent(version: string): string {
  return `${SPIRIT_AGENT_UA_PRODUCT}/${version.trim()}`;
}

export function getLlmClientVersion(): string {
  return configuredClientVersion;
}

export function configureLlmClientVersion(version: string): void {
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    return;
  }
  configuredClientVersion = trimmed;
}

export function mergeLlmFetchInit(init?: RequestInit): RequestInit {
  const userAgent = buildSpiritAgentUserAgent(configuredClientVersion);
  const sourceHeaders = init?.headers;

  if (sourceHeaders instanceof Headers) {
    const headers = new Headers(sourceHeaders);
    headers.set('User-Agent', userAgent);
    return { ...init, headers };
  }

  const headers = new Headers();
  if (Array.isArray(sourceHeaders)) {
    for (const [key, value] of sourceHeaders) {
      headers.append(key, value);
    }
  } else if (sourceHeaders && typeof sourceHeaders === 'object') {
    for (const [key, value] of Object.entries(sourceHeaders)) {
      if (value !== undefined) {
        headers.set(key, value);
      }
    }
  }
  headers.set('User-Agent', userAgent);
  return { ...init, headers };
}

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
  const fetchWithDispatcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const mergedInit = mergeLlmFetchInit(init);
    if (llmFetchTransportOverride) {
      return llmFetchTransportOverride(input, mergedInit);
    }
    return undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...mergedInit, dispatcher } as Parameters<typeof undiciFetch>[1],
    );
  };
  return fetchWithDispatcher as unknown as typeof fetch;
}
