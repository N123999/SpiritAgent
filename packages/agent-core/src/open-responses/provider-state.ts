import type { JsonObject, JsonValue } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import { resolveOpenResponsesSdkProvider, type OpenResponsesTransportConfig } from './responses-compat.js';

const RESPONSE_ID_PROVIDER_KEYS = ['openAiResponses', 'openResponses'] as const;

function readResponseIdFromProviderBucket(bucket: unknown): string | undefined {
  if (!isJsonObject(bucket as JsonValue | undefined)) {
    return undefined;
  }

  const responseId = (bucket as JsonObject).responseId;
  return typeof responseId === 'string' && responseId.length > 0 ? responseId : undefined;
}

export function readResponseIdFromMessage(message: JsonObject): string | undefined {
  const fromNested = readResponseIdFromProviderState(message);
  if (fromNested) {
    return fromNested;
  }

  for (const key of RESPONSE_ID_PROVIDER_KEYS) {
    const responseId = readResponseIdFromProviderBucket(message[key]);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function findPreviousResponseId(messages: readonly JsonValue[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }

    const responseId = readResponseIdFromMessage(message);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function findAnchorIndexForResponseId(
  messages: readonly JsonValue[],
  responseId: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }

    if (readResponseIdFromMessage(message) === responseId) {
      return index;
    }
  }

  return -1;
}

export function readResponseIdFromProviderState(message: JsonObject): string | undefined {
  if (!isJsonObject(message.providerState)) {
    return undefined;
  }

  for (const key of RESPONSE_ID_PROVIDER_KEYS) {
    const responseId = readResponseIdFromProviderBucket(message.providerState[key]);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function attachResponseIdToAssistantMessage(
  config: OpenResponsesTransportConfig,
  message: JsonValue,
  responseId: string | undefined,
): JsonValue {
  if (!responseId || !isJsonObject(message)) {
    return message;
  }

  const providerKey =
    resolveOpenResponsesSdkProvider(config) === 'openai' ? 'openAiResponses' : 'openResponses';
  const existingProviderState: JsonObject = isJsonObject(message.providerState)
    ? (cloneJsonValue(message.providerState) as JsonObject)
    : {};

  return {
    ...message,
    providerState: {
      ...existingProviderState,
      [providerKey]: {
        responseId,
      },
    },
  };
}

export function extractResponseIdFromGenerateTextResult(result: {
  providerMetadata?: unknown;
  response?: { id?: string };
}): string | undefined {
  const fromResponse =
    result.response && typeof result.response.id === 'string' && result.response.id.length > 0
      ? result.response.id
      : undefined;
  if (fromResponse) {
    return fromResponse;
  }

  if (!isJsonObject(result.providerMetadata as JsonValue | undefined)) {
    return undefined;
  }

  const openai = (result.providerMetadata as JsonObject).openai;
  if (isJsonObject(openai) && typeof openai.responseId === 'string' && openai.responseId.length > 0) {
    return openai.responseId;
  }

  return undefined;
}
