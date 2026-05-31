import type { JsonObject, JsonValue } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import { resolveOpenResponsesSdkProvider, type OpenResponsesTransportConfig } from './responses-compat.js';

export function findPreviousResponseId(messages: readonly JsonValue[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }

    const responseId = readResponseIdFromProviderState(message);
    if (responseId) {
      return responseId;
    }
  }

  return undefined;
}

export function readResponseIdFromProviderState(message: JsonObject): string | undefined {
  if (!isJsonObject(message.providerState)) {
    return undefined;
  }

  const openAi = message.providerState.openAiResponses;
  if (isJsonObject(openAi) && typeof openAi.responseId === 'string' && openAi.responseId.length > 0) {
    return openAi.responseId;
  }

  const openResponses = message.providerState.openResponses;
  if (
    isJsonObject(openResponses) &&
    typeof openResponses.responseId === 'string' &&
    openResponses.responseId.length > 0
  ) {
    return openResponses.responseId;
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
