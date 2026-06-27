import { jsonSchema, tool } from 'ai';

import { buildAiSdkUserImageFilePartFromUrl } from '../ai-sdk-image-url-part.js';

import type { JsonObject, JsonValue, ToolCallRequest } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import {
  normalizeApplyPatchToolCallArgumentsJson,
  prepareApplyPatchRequestBodyStash,
  readApplyPatchToolResultProviderState,
} from './apply-patch-bridge.js';
import {
  APPLY_PATCH_HOST_TOOL_NAME,
  shouldOmitApplyPatchFromAiSdkMessages,
  shouldUseOpenAiSdkApplyPatchTool,
} from './apply-patch-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

type AiSdkToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type OpenAiFunctionToolDefinition = JsonObject & {
  type: 'function';
  function: JsonObject;
};

export function normalizeResponsesToolDefinitions(tools: JsonValue): OpenAiFunctionToolDefinition[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isFunctionToolDefinition)
    .map((toolDefinition) => cloneJsonValue(toolDefinition) as OpenAiFunctionToolDefinition);
}

export function buildResponsesAiSdkTools(
  normalizedTools: OpenAiFunctionToolDefinition[],
): Record<string, ReturnType<typeof tool>> {
  return Object.fromEntries(
    normalizedTools.flatMap((toolDefinition) => {
      const functionDefinition = toolDefinition.function;
      if (typeof functionDefinition.name !== 'string' || !isJsonObject(functionDefinition.parameters)) {
        return [];
      }

      return [[
        functionDefinition.name,
        tool({
          ...(typeof functionDefinition.description === 'string'
            ? { description: functionDefinition.description }
            : {}),
          inputSchema: jsonSchema(functionDefinition.parameters as Record<string, unknown>),
        }),
      ]];
    }),
  );
}

export function openAiMessagesToResponsesAiSdkMessages(
  messages: JsonValue[],
  config?: Pick<
    OpenResponsesTransportConfig,
    'baseUrl' | 'transportKind' | 'model' | 'llmVendor' | 'responsesProvider'
  >,
): Array<Record<string, unknown>> {
  const useSdkApplyPatch = config !== undefined && shouldUseOpenAiSdkApplyPatchTool(config);
  const omitApplyPatchFromSdkMessages =
    config !== undefined && shouldOmitApplyPatchFromAiSdkMessages(config);
  if (omitApplyPatchFromSdkMessages) {
    prepareApplyPatchRequestBodyStash(messages);
  }
  const toolCallNames = buildToolCallNameIndex(messages);

  const sdkMessages = messages.flatMap((message) => {
    if (!isJsonObject(message) || typeof message.role !== 'string') {
      return [];
    }

    switch (message.role) {
      case 'system':
        return typeof message.content === 'string'
          ? [{ role: 'system', content: message.content }]
          : [];
      case 'user': {
        const content = openAiUserContentToAiSdkContent(message.content);
        return content === undefined ? [] : [{ role: 'user', content }];
      }
      case 'assistant': {
        const assistantMessage = openAiAssistantMessageToAiSdkMessage(
          message,
          useSdkApplyPatch,
          omitApplyPatchFromSdkMessages,
        );
        return assistantMessage === undefined ? [] : [assistantMessage];
      }
      case 'tool': {
        const toolMessage = openAiToolMessageToAiSdkMessage(
          message,
          toolCallNames,
          useSdkApplyPatch,
          omitApplyPatchFromSdkMessages,
        );
        return toolMessage === undefined ? [] : [toolMessage];
      }
      default:
        return [];
    }
  });

  return sdkMessages;
}

export function buildAssistantMessageFromResponsesGenerateText(
  text: string,
  toolCalls: readonly AiSdkToolCall[],
  reasoningText = '',
): JsonValue {
  const reasoningContent = reasoningText.trim();
  return withReasoningContentIfNeeded(
    {
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((toolCall) => ({
              id: toolCall.toolCallId,
              type: 'function',
              function: {
                name: toolCall.toolName,
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          }
        : {}),
    },
    reasoningContent,
  );
}

export function extractToolCallsFromAiSdk(toolCalls: readonly AiSdkToolCall[]): ToolCallRequest[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    argumentsJson: JSON.stringify(toolCall.input),
  }));
}

export function renderResponsesTransportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function openAiUserContentToAiSdkContent(
  content: JsonValue | undefined,
): string | Array<Record<string, unknown>> | undefined {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!isJsonObject(part) || typeof part.type !== 'string') {
      continue;
    }

    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else if (
      part.type === 'image_url' &&
      isJsonObject(part.image_url) &&
      typeof part.image_url.url === 'string'
    ) {
      parts.push(buildAiSdkUserImageFilePartFromUrl(part.image_url.url));
    }
  }

  return parts.length > 0 ? parts : undefined;
}

function openAiAssistantMessageToAiSdkMessage(
  message: JsonObject,
  useSdkApplyPatch: boolean,
  omitApplyPatchFromSdkMessages: boolean,
): Record<string, unknown> | undefined {
  const reasoningText = extractAssistantReasoningContentFromJson(message);
  const toolCallParts = extractAssistantToolCallParts(
    message,
    useSdkApplyPatch,
    omitApplyPatchFromSdkMessages,
  );
  const contentParts: Array<Record<string, unknown>> = [];

  if (reasoningText) {
    contentParts.push({ type: 'reasoning', text: reasoningText });
  }

  if (typeof message.content === 'string' && message.content.length > 0) {
    contentParts.push({ type: 'text', text: message.content });
  }

  contentParts.push(...toolCallParts);

  if (contentParts.length === 0) {
    if (typeof message.content === 'string') {
      return { role: 'assistant', content: message.content };
    }

    return undefined;
  }

  return {
    role: 'assistant',
    content: contentParts,
  };
}

function openAiToolMessageToAiSdkMessage(
  message: JsonObject,
  toolCallNames: Map<string, string>,
  useSdkApplyPatch: boolean,
  omitApplyPatchFromSdkMessages: boolean,
): Record<string, unknown> | undefined {
  const toolCallId = nonEmptyToolCallIdOrUndefined(message.tool_call_id);
  if (!toolCallId) {
    return undefined;
  }

  const toolName = toolCallNames.get(toolCallId) ?? 'unknown_tool';
  if (toolName === APPLY_PATCH_HOST_TOOL_NAME) {
    if (omitApplyPatchFromSdkMessages) {
      return undefined;
    }

    if (useSdkApplyPatch) {
      const patchOutput = readApplyPatchToolResultProviderState(message);
      const failedText = typeof message.content === 'string' ? message.content : '';
      const status = patchOutput?.status === 'failed' ? 'failed' : 'completed';
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName: APPLY_PATCH_HOST_TOOL_NAME,
            output: {
              type: 'json',
              value: {
                status,
                ...(patchOutput?.output
                  ? { output: patchOutput.output }
                  : status === 'failed' && failedText
                    ? { output: failedText }
                    : {}),
              },
            },
          },
        ],
      };
    }
  }
  const result = tryParseJsonValue(message.content);
  const output =
    result === undefined
      ? {
          type: 'text',
          value: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
        }
      : {
          type: 'json',
          value: result,
        };

  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId,
        toolName,
        output,
      },
    ],
  };
}

function buildToolCallNameIndex(messages: JsonValue[]): Map<string, string> {
  const toolCallNames = new Map<string, string>();

  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      continue;
    }

    for (const toolCall of message.tool_calls) {
      if (!isJsonObject(toolCall) || !isJsonObject(toolCall.function)) {
        continue;
      }

      if (!hasNonEmptyToolCallId(toolCall.id) || typeof toolCall.function.name !== 'string') {
        continue;
      }

      toolCallNames.set(toolCall.id, toolCall.function.name);
    }
  }

  return toolCallNames;
}

function extractAssistantToolCallParts(
  message: JsonObject,
  useSdkApplyPatch: boolean,
  omitApplyPatchFromSdkMessages: boolean,
): Array<Record<string, unknown>> {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls.flatMap((toolCall) => {
    if (!isJsonObject(toolCall) || !isJsonObject(toolCall.function)) {
      return [];
    }

    if (!hasNonEmptyToolCallId(toolCall.id) || typeof toolCall.function.name !== 'string') {
      return [];
    }

    const toolName = toolCall.function.name;
    if (toolName === APPLY_PATCH_HOST_TOOL_NAME && omitApplyPatchFromSdkMessages) {
      return [];
    }

    const rawArguments = typeof toolCall.function.arguments === 'string'
      ? toolCall.function.arguments
      : JSON.stringify(toolCall.function.arguments ?? {});
    const input = toolName === APPLY_PATCH_HOST_TOOL_NAME
      ? tryParseJsonValue(normalizeApplyPatchToolCallArgumentsJson(toolCall.id, rawArguments)) ?? {}
      : tryParseJsonValue(toolCall.function.arguments) ?? toolCall.function.arguments ?? {};

    return [{
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName,
      input,
    }];
  });
}

function withReasoningContentIfNeeded(
  message: JsonObject,
  reasoningContent: string,
): JsonValue {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if ('reasoning_content' in message) {
    return message;
  }

  if (reasoningContent.length > 0) {
    return {
      ...message,
      reasoning_content: reasoningContent,
    };
  }

  if (toolCalls.length > 0) {
    return {
      ...message,
      reasoning_content: '',
    };
  }

  return message;
}

function extractAssistantReasoningContentFromJson(message: JsonObject): string {
  return [
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');
}

function isFunctionToolDefinition(value: JsonValue): value is OpenAiFunctionToolDefinition {
  return isJsonObject(value) && value.type === 'function' && isJsonObject(value.function);
}

function tryParseJsonValue(value: unknown): JsonValue | undefined {
  if (typeof value !== 'string') {
    return value as JsonValue | undefined;
  }

  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

function hasNonEmptyToolCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonEmptyToolCallIdOrUndefined(value: unknown): string | undefined {
  return hasNonEmptyToolCallId(value) ? value : undefined;
}
