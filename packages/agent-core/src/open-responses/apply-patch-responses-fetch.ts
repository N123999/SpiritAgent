import type { JsonObject, JsonValue } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import {
  extractApplyPatchCallsFromResponsesBody,
  patchResponsesRequestBodyForApplyPatch,
  registerPendingApplyPatchCallIds,
  stashLastExtractedApplyPatchCalls,
  stripApplyPatchCallsFromResponsesBody,
} from './apply-patch-bridge.js';
import { shouldUseApplyPatchFileTools } from './apply-patch-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

type FetchFn = typeof fetch;

export function createApplyPatchAwareFetch(
  config: OpenResponsesTransportConfig,
  baseFetch: FetchFn = globalThis.fetch,
): FetchFn {
  if (!shouldUseApplyPatchFileTools(config)) {
    return baseFetch;
  }

  return async (input, init) => {
    const patchedInit = patchRequestInitBody(init, config);
    const response = await baseFetch(input, patchedInit);
    return patchResponsesJsonResponse(response);
  };
}

function patchRequestInitBody(
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

    patchResponsesRequestBodyForApplyPatch(body, config);
    return {
      ...init,
      body: JSON.stringify(body),
    };
  } catch {
    return init;
  }
}

async function patchResponsesJsonResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return response;
  }

  const rawText = await response.text();
  try {
    const body = JSON.parse(rawText) as JsonObject;
    if (!isJsonObject(body as JsonValue)) {
      return new Response(rawText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    const applyPatchCalls = extractApplyPatchCallsFromResponsesBody(body);
    if (applyPatchCalls.length > 0) {
      stashLastExtractedApplyPatchCalls(applyPatchCalls);
      registerPendingApplyPatchCallIds(applyPatchCalls.map((call) => call.id));
    }
    stripApplyPatchCallsFromResponsesBody(body);

    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return new Response(rawText, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}
