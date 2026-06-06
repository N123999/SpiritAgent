import { getLlmFetch } from '../llm-fetch.js';
import type { JsonObject, JsonValue } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import type { OpenAiTransportConfig } from '../openai/openai-compat.js';
import {
  buildAlibabaChatCompletionsExtraBody,
  shouldUseAlibabaChatCompletionsBuiltInTools,
} from './alibaba-built-in-tools.js';

type FetchFn = typeof fetch;

export function createAlibabaChatCompletionsAwareFetch(
  config: OpenAiTransportConfig,
  baseFetch: FetchFn = getLlmFetch(),
): FetchFn {
  if (!shouldUseAlibabaChatCompletionsBuiltInTools(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    const patchedInit = patchAlibabaChatCompletionsRequestInit(init);
    return baseFetch(input, patchedInit);
  };
}

function patchAlibabaChatCompletionsRequestInit(
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

    const streaming = body.stream === true;
    const extraBody = buildAlibabaChatCompletionsExtraBody({ streaming });
    const existingExtraBody = isJsonObject(body.extra_body as JsonValue)
      ? (body.extra_body as JsonObject)
      : {};

    return {
      ...init,
      body: JSON.stringify({
        ...body,
        extra_body: {
          ...existingExtraBody,
          ...extraBody,
        },
      }),
    };
  } catch {
    return init;
  }
}
