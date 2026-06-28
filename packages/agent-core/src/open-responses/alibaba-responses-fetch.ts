import { getLlmFetch } from '../llm-fetch.js';
import type { JsonObject, JsonValue } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import {
  mergeAlibabaResponsesBuiltInTools,
  shouldUseAlibabaResponsesBuiltInTools,
} from './alibaba-built-in-tools.js';
import {
  readResponsesStoredStateRequestPreviousResponseId,
  responsesUsesStoredState,
} from './responses-incremental-input.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

type FetchFn = typeof fetch;

export function createAlibabaResponsesAwareFetch(
  config: OpenResponsesTransportConfig,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  if (!shouldUseAlibabaResponsesBuiltInTools(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    const patchedInit = patchAlibabaResponsesRequestInit(init, config);
    return baseFetch(input, patchedInit);
  };
}

function patchAlibabaResponsesRequestInit(
  init: RequestInit | undefined,
  config: OpenResponsesTransportConfig,
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
    const patched: JsonObject = {
      ...body,
      tools: mergeAlibabaResponsesBuiltInTools(existingTools),
    };

    if (responsesUsesStoredState(config)) {
      patched.store = config.store ?? true;
      const previousResponseId = readResponsesStoredStateRequestPreviousResponseId();
      if (previousResponseId) {
        patched.previous_response_id = previousResponseId;
      }
    }

    return {
      ...init,
      body: JSON.stringify(patched),
    };
  } catch {
    return init;
  }
}
