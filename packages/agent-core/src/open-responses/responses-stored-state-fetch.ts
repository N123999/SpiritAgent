import { getLlmFetch } from '../llm-fetch.js';
import type { JsonObject, JsonValue } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import {
  readResponsesStoredStateRequestPreviousResponseId,
  responsesUsesStoredState,
} from './responses-incremental-input.js';
import {
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

type FetchFn = typeof fetch;

export function shouldUseResponsesStoredStateFetch(
  config: OpenResponsesTransportConfig,
): boolean {
  return (
    responsesUsesStoredState(config)
    && resolveOpenResponsesSdkProvider(config) === 'open-responses-compatible'
  );
}

export function createResponsesStoredStateAwareFetch(
  config: OpenResponsesTransportConfig,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  if (!shouldUseResponsesStoredStateFetch(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    const patchedInit = patchResponsesStoredStateRequestInit(init, config);
    return baseFetch(input, patchedInit);
  };
}

export function patchResponsesStoredStateRequestInit(
  init: RequestInit | undefined,
  config: OpenResponsesTransportConfig,
): RequestInit | undefined {
  if (!responsesUsesStoredState(config) || !init?.body || typeof init.body !== 'string') {
    return init;
  }

  try {
    const body = JSON.parse(init.body) as JsonObject;
    if (!isJsonObject(body as JsonValue)) {
      return init;
    }

    const patched: JsonObject = { ...body };
    patched.store = config.store ?? true;
    const previousResponseId = readResponsesStoredStateRequestPreviousResponseId();
    if (previousResponseId) {
      patched.previous_response_id = previousResponseId;
    }

    return {
      ...init,
      body: JSON.stringify(patched),
    };
  } catch {
    return init;
  }
}
