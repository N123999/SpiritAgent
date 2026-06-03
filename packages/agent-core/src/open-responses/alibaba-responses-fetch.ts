import type { JsonObject, JsonValue } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import {
  mergeAlibabaResponsesBuiltinTools,
  shouldUseAlibabaResponsesNativeTools,
} from './alibaba-native-tools.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

type FetchFn = typeof fetch;

export function createAlibabaResponsesAwareFetch(
  config: OpenResponsesTransportConfig,
  baseFetch: FetchFn = globalThis.fetch,
): FetchFn {
  if (!shouldUseAlibabaResponsesNativeTools(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    const patchedInit = patchAlibabaResponsesRequestInit(init);
    return baseFetch(input, patchedInit);
  };
}

function patchAlibabaResponsesRequestInit(
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (!init?.body || typeof init.body !== 'string') {
    return init;
  }

  try {
    const body = JSON.parse(init.body) as JsonObject;
    if (!isJsonObject(body as JsonValue)) {
      return init;
    }

    const existingTools = Array.isArray(body.tools) ? body.tools : [];
    return {
      ...init,
      body: JSON.stringify({
        ...body,
        tools: mergeAlibabaResponsesBuiltinTools(existingTools),
      }),
    };
  } catch {
    return init;
  }
}
