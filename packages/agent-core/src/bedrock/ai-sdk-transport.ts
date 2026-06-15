import { readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';

import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

import { getLlmFetch } from '../llm-fetch.js';
import {
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type TextStreamPart,
} from 'ai';

import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
} from '../openai/json-schema.js';
import { readAiSdkUsage } from '../ai-sdk-usage.js';
import { finishTaskStreamingPreviewReady } from '../finish-task-preview.js';
import {
  hostToolArgumentsReadyForEarlyStreamingPreview,
  hostToolArgumentsReadyForPreview,
  resolveStreamingToolPreviewEmit,
} from '../tool-streaming-preview-gate.js';
import {
  COMPACT_SUMMARY_PREFIX,
  buildCompactHistoryPromptMessages,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from '../tool-agent.js';
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
  JsonObject,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  ToolExecutionOutput,
} from '../ports.js';
import { llmMessageTextContent } from '../ports.js';
import type { JsonSchemaTransport } from '../json-schema.js';
import {
  buildBedrockProviderOptions,
  buildBedrockRequestTrace,
  type BedrockTransportConfig,
} from './bedrock-compat.js';

type AnthropicToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type OpenAiStyleFunctionToolDefinition = JsonObject & {
  type: 'function';
  function: JsonObject;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

interface StreamingToolCallAccumulator {
  toolCallId: string;
  toolName: string;
  argumentsJson: string;
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

type AnthropicToolCallStreamingStartPart = {
  type: 'tool-call-streaming-start';
  toolCallId: string;
  toolName: string;
};

type AnthropicToolCallDeltaPart = {
  type: 'tool-call-delta';
  toolCallId: string;
  toolName: string;
  argsTextDelta: string;
};

const BEDROCK_PROJECTED_SYSTEM_CONTEXT_PREFIX = '[HOST_CONTEXT_FROM_SYSTEM]';

export class AiSdkBedrockTransport
  implements LlmTransport<BedrockTransportConfig, ToolAgentState>, JsonSchemaTransport
{
  async generateImage(
    _config: BedrockTransportConfig,
    _request: ImageGenerationRequest,
    _saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    throw new Error('Bedrock transport does not support image generation.');
  }

  async generateVideo(
    _config: BedrockTransportConfig,
    _request: import('../ports.js').VideoGenerationRequest,
    _saveGeneratedVideo: (request: import('../ports.js').GeneratedVideoSaveRequest) => Promise<import('../ports.js').GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    throw new Error('Bedrock transport does not support video generation.');
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: BedrockTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const messages = buildJsonSchemaCompletionMessages(
      { model: config.model },
      request,
    );
    const normalizedMessages = normalizeMessagesForBedrockPrompt(messages);
    const requestTrace = buildBedrockRequestTrace(config, 1, normalizedMessages, []);

    try {
      const result = await generateObject({
        model: createBedrockLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(normalizedMessages) as any,
        allowSystemInMessages: true,
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildBedrockProviderOptions(config),
        maxRetries: 0,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderAiSdkError(error));
    }
  }

  async startToolAgentRound(
    config: BedrockTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedRequestMessages = normalizeMessagesForBedrockPrompt(requestMessages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildBedrockRequestTrace(
      config,
      nextState.steps,
      normalizedRequestMessages,
      normalizedTools,
    );

    try {
      const result: any = await generateText({
        model: createBedrockLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(normalizedRequestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildBedrockProviderOptions(config),
        maxRetries: 0,
      });

      nextState.messages.push(
        buildAssistantMessageFromGenerateTextResult(
          result.text,
          typeof result.reasoningText === 'string' ? result.reasoningText : '',
          result.reasoning,
          result.toolCalls,
        ),
      );

      const usage = await readAiSdkUsage(result);
      const calls = extractToolCallsFromAiSdk(result.toolCalls);
      if (calls.length > 0) {
        return {
          kind: 'success',
          result: {
            state: nextState,
            step: { kind: 'tool-calls', calls },
            requestTrace,
            ...(usage ? { usage } : {}),
          },
        };
      }

      return {
        kind: 'success',
        result: {
          state: nextState,
          step: { kind: 'final-response-ready' },
          requestTrace,
          ...(usage ? { usage } : {}),
        },
      };
    } catch (error) {
      return {
        kind: 'failure',
        error: renderAiSdkError(error),
        requestTrace,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: BedrockTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedRequestMessages = normalizeMessagesForBedrockPrompt(requestMessages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildBedrockRequestTrace(
      config,
      nextState.steps,
      normalizedRequestMessages,
      normalizedTools,
      true,
    );
    const abortController = new AbortController();

    try {
      const result: any = streamText({
        model: createBedrockLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(normalizedRequestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildBedrockProviderOptions(config),
        includeRawChunks: false,
        maxRetries: 0,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      return {
        eventStream: bedrockEventStreamToRuntimeEvents(
          result.fullStream,
          result,
          nextState,
          requestTrace,
          completion,
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: renderAiSdkError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: BedrockTransportConfig,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
    context?: import('../ports.js').CompactHistoryManualContext,
  ): Promise<{
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  }> {
    const beforeLength = history.length;
    if (beforeLength === 0) {
      return {
        droppedMessages: 0,
        beforeLength,
        afterLength: 0,
      };
    }

    const promptMessages = toolStateMessagesToAiSdkMessages(
      buildCompactHistoryPromptMessages(history, {
        ...(context?.preCompactionArchivePath === undefined
          ? {}
          : { preCompactionArchivePath: context.preCompactionArchivePath }),
      }),
    );
    const compactConfig: BedrockTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createBedrockLanguageModel(compactConfig),
          messages: promptMessages as any,
          allowSystemInMessages: true,
          providerOptions: buildBedrockProviderOptions(compactConfig),
          maxRetries: 0,
        });

        for await (const part of streamed.fullStream) {
          if (part.type !== 'text-delta') {
            continue;
          }

          const normalizedText = trimLeadingStreamLineBreaks(summary, part.text);
          if (!normalizedText) {
            continue;
          }

          summary += normalizedText;
          emittedProgress = true;
          onProgress(normalizedText);
        }
      } catch (error) {
        if (emittedProgress) {
          throw error;
        }
      }
    }

    if (!summary.trim()) {
      const result = await generateText({
        model: createBedrockLanguageModel(compactConfig),
        messages: promptMessages as any,
        allowSystemInMessages: true,
        providerOptions: buildBedrockProviderOptions(compactConfig),
        maxRetries: 0,
      });
      summary = result.text;
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error('AI SDK 压缩返回为空，无法生成摘要。');
    }

    history.splice(0, history.length, {
      role: 'system',
      content: [{ type: 'text', text: `${COMPACT_SUMMARY_PREFIX}\n${normalizedSummary}` }],
    });

    return {
      droppedMessages: Math.max(0, beforeLength - 1),
      beforeLength,
      afterLength: history.length,
    };
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return history
      .find(
        (message) =>
          message.role === 'system' && llmMessageTextContent(message.content).startsWith(COMPACT_SUMMARY_PREFIX),
      )
      ?.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .slice(COMPACT_SUMMARY_PREFIX.length)
      .trim() || undefined;
  }

  isContextOverflowError(error: string): boolean {
    const normalized = error.toLowerCase();
    return (
      normalized.includes('context length') ||
      normalized.includes('maximum context length') ||
      normalized.includes('too many tokens') ||
      normalized.includes('context_window_exceeded')
    );
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return normalizeMessagesForBedrockPrompt(llmHistoryToToolStateMessages(history));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt('—'),
    };
  }
}

function createBedrockLanguageModel(config: BedrockTransportConfig): any {
  const provider = createAmazonBedrock({
    region: config.region,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    ...(config.accessKeyId?.trim() && config.secretAccessKey?.trim()
      ? {
          accessKeyId: config.accessKeyId.trim(),
          secretAccessKey: config.secretAccessKey.trim(),
          ...(config.sessionToken?.trim() ? { sessionToken: config.sessionToken.trim() } : {}),
        }
      : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: getLlmFetch(),
  });
  return provider(config.model);
}

function normalizeToolDefinitions(tools: JsonValue): OpenAiStyleFunctionToolDefinition[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isFunctionToolDefinition)
    .map((toolDefinition) => cloneJsonValue(toolDefinition) as OpenAiStyleFunctionToolDefinition);
}

function buildAiSdkTools(
  normalizedTools: OpenAiStyleFunctionToolDefinition[],
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

function toolStateMessagesToAiSdkMessages(messages: JsonValue[]): Array<Record<string, unknown>> {
  const toolCallNames = buildToolCallNameIndex(messages);

  return messages.flatMap((message) => {
    if (!isJsonObject(message) || typeof message.role !== 'string') {
      return [];
    }

    switch (message.role) {
      case 'system':
        return typeof message.content === 'string' ? [{ role: 'system', content: message.content }] : [];
      case 'user': {
        const content = userContentToAiSdkContent(message.content);
        return content === undefined ? [] : [{ role: 'user', content }];
      }
      case 'assistant': {
        const assistantMessage = assistantMessageToAiSdkMessage(message);
        return assistantMessage === undefined ? [] : [assistantMessage];
      }
      case 'tool': {
        const toolMessage = toolMessageToAiSdkMessage(message, toolCallNames);
        return toolMessage === undefined ? [] : [toolMessage];
      }
      default:
        return [];
    }
  });
}

function normalizeMessagesForBedrockPrompt(messages: JsonValue[]): JsonValue[] {
  const normalizedMessages: JsonValue[] = [];
  let sawNonSystemMessage = false;

  for (const message of messages) {
    if (!isJsonObject(message) || typeof message.role !== 'string') {
      continue;
    }

    if (message.role === 'system') {
      if (!sawNonSystemMessage) {
        normalizedMessages.push(cloneJsonValue(message));
      } else {
        const projected = projectSeparatedSystemMessageForBedrock(message);
        if (projected !== undefined) {
          normalizedMessages.push(projected);
        }
      }
      continue;
    }

    sawNonSystemMessage = true;
    normalizedMessages.push(cloneJsonValue(message));
  }

  return normalizedMessages;
}

function projectSeparatedSystemMessageForBedrock(message: JsonObject): JsonValue | undefined {
  if (typeof message.content !== 'string' || message.content.trim().length === 0) {
    return undefined;
  }

  return {
    role: 'user',
    content: [
      BEDROCK_PROJECTED_SYSTEM_CONTEXT_PREFIX,
      'The host is providing additional context that was originally stored as a system message after the conversation had already started.',
      'Treat it as reference context for continuity, not as a new user request.',
      '',
      message.content,
    ].join('\n'),
  } satisfies JsonObject;
}

function userContentToAiSdkContent(
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

    switch (part.type) {
      case 'text':
        if (typeof part.text === 'string') {
          parts.push({ type: 'text', text: part.text });
        }
        break;
      case 'image_url':
        if (isJsonObject(part.image_url) && typeof part.image_url.url === 'string') {
          parts.push({ type: 'image', image: part.image_url.url });
        }
        break;
      default:
        break;
    }
  }

  return parts.length > 0 ? parts : undefined;
}

function assistantMessageToAiSdkMessage(message: JsonObject): Record<string, unknown> | undefined {
  const reasoningParts = extractStoredBedrockReasoningParts(message);
  const reasoningText = extractAssistantReasoningContentFromJson(message);
  const toolCallParts = extractAssistantToolCallParts(message);
  const contentParts: Array<Record<string, unknown>> = [];

  if (reasoningParts.length > 0) {
    contentParts.push(...reasoningParts);
  } else if (reasoningText) {
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

function toolMessageToAiSdkMessage(
  message: JsonObject,
  toolCallNames: Map<string, string>,
): Record<string, unknown> | undefined {
  const toolCallId = nonEmptyToolCallIdOrUndefined(message.tool_call_id);
  if (!toolCallId) {
    return undefined;
  }

  const toolName = toolCallNames.get(toolCallId) ?? 'unknown_tool';
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

function extractAssistantToolCallParts(message: JsonObject): Array<Record<string, unknown>> {
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

    return [{
      type: 'tool-call',
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      input: tryParseJsonValue(toolCall.function.arguments) ?? toolCall.function.arguments ?? {},
    }];
  });
}

function buildAssistantMessageFromGenerateTextResult(
  text: string,
  reasoningText: string,
  reasoning: unknown,
  toolCalls: readonly AnthropicToolCall[],
): JsonValue {
  return withReasoningContentIfNeeded(
    withStoredBedrockReasoningPartsIfNeeded(
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
      normalizeAiSdkReasoningParts(reasoning),
    ),
    reasoningText,
  );
}

async function* bedrockEventStreamToRuntimeEvents(
  stream: AsyncIterable<TextStreamPart<any>>,
  result: Parameters<typeof readAiSdkUsage>[0] & {
    reasoning?: PromiseLike<unknown>;
  },
  nextState: ToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<ToolAgentState>>,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<string, StreamingToolCallAccumulator>();
  const toolCallOrder: string[] = [];
  let assistantContent = '';
  let reasoningContent = '';
  let sawAnswerOrToolOutput = false;

  try {
    for await (const part of stream) {
      const rawType = (part as { type?: unknown }).type;

      if (rawType === 'tool-call-streaming-start') {
        const streamingStart = part as unknown as AnthropicToolCallStreamingStartPart;
        sawAnswerOrToolOutput = true;
        if (!toolCalls.has(streamingStart.toolCallId)) {
          toolCalls.set(streamingStart.toolCallId, {
            toolCallId: streamingStart.toolCallId,
            toolName: streamingStart.toolName,
            argumentsJson: '',
            readyPreviewEmitted: false,
          });
          toolCallOrder.push(streamingStart.toolCallId);
        }
        continue;
      }

      if (rawType === 'tool-call-delta') {
        const toolCallDelta = part as unknown as AnthropicToolCallDeltaPart;
        sawAnswerOrToolOutput = true;
        const current = toolCalls.get(toolCallDelta.toolCallId) ?? {
          toolCallId: toolCallDelta.toolCallId,
          toolName: toolCallDelta.toolName,
          argumentsJson: '',
          readyPreviewEmitted: false,
        };
        current.argumentsJson += toolCallDelta.argsTextDelta;
        const previewState = {
          readyPreviewEmitted: current.readyPreviewEmitted,
          ...(current.lastPreviewArgsLen === undefined
            ? {}
            : { lastPreviewArgsLen: current.lastPreviewArgsLen }),
          ...(current.lastPreviewDetailSignature === undefined
            ? {}
            : { lastPreviewDetailSignature: current.lastPreviewDetailSignature }),
        };
        const previewDecision = resolveStreamingToolPreviewEmit(
          current.toolName,
          current.argumentsJson,
          previewState,
        );
        if (previewDecision.emit) {
          current.readyPreviewEmitted = previewDecision.nextState.readyPreviewEmitted;
          if (previewDecision.nextState.lastPreviewArgsLen !== undefined) {
            current.lastPreviewArgsLen = previewDecision.nextState.lastPreviewArgsLen;
          }
          if (previewDecision.nextState.lastPreviewDetailSignature !== undefined) {
            current.lastPreviewDetailSignature = previewDecision.nextState.lastPreviewDetailSignature;
          }
          yield {
            kind: 'streaming-tool-preview',
            toolCallId: current.toolCallId,
            toolName: current.toolName,
            argumentsJson: current.argumentsJson,
          };
        }
        toolCalls.set(toolCallDelta.toolCallId, current);
        if (!toolCallOrder.includes(toolCallDelta.toolCallId)) {
          toolCallOrder.push(toolCallDelta.toolCallId);
        }
        continue;
      }

      switch (part.type) {
        case 'reasoning-delta':
          reasoningContent += part.text;
          if (part.text.length > 0) {
            yield { kind: 'thinking-chunk', text: part.text };
          }
          break;
        case 'text-delta': {
          const normalizedText = trimLeadingStreamLineBreaks(assistantContent, part.text);
          if (!normalizedText) {
            break;
          }
          sawAnswerOrToolOutput = true;
          assistantContent += normalizedText;
          yield { kind: 'assistant-chunk', text: normalizedText };
          break;
        }
        case 'tool-call': {
          sawAnswerOrToolOutput = true;
          const argumentsJson = JSON.stringify(part.input);
          const current = toolCalls.get(part.toolCallId) ?? {
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            argumentsJson,
            readyPreviewEmitted: false,
          };
          current.toolName = part.toolName;
          current.argumentsJson = argumentsJson;
          if (toolArgumentsReadyForStreamingPreview(current.toolName, current.argumentsJson)) {
            yield {
              kind: 'streaming-tool-preview',
              toolCallId: current.toolCallId,
              toolName: current.toolName,
              argumentsJson: current.argumentsJson,
            };
          }
          toolCalls.set(part.toolCallId, current);
          if (!toolCallOrder.includes(part.toolCallId)) {
            toolCallOrder.push(part.toolCallId);
          }
          break;
        }
        case 'error':
          throw part.error;
        default:
          break;
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      throw new Error('流式响应无任何 delta（无文本 / thinking / tool calls）。');
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(
        assistantContent,
        reasoningContent,
        await result.reasoning,
        toolCalls,
        toolCallOrder,
      ),
    );

    const calls = extractToolCallsFromStreamingMap(toolCalls, toolCallOrder);
    const usage = await readAiSdkUsage(result);
    completion.resolve({
      kind: 'success',
      result: {
        state: nextState,
        step: calls.length > 0 ? { kind: 'tool-calls', calls } : { kind: 'final-response-ready' },
        requestTrace,
        ...(usage ? { usage } : {}),
      },
    });
    yield { kind: 'done' };
  } catch (error) {
    const rendered = renderAiSdkError(error);
    completion.resolve({
      kind: 'failure',
      error: rendered,
      requestTrace,
    });
    yield { kind: 'error', error: rendered };
  }
}

function toolArgumentsReadyForStreamingPreview(name: string, argumentsJson: string): boolean {
  if (name === 'finish_task') {
    return finishTaskStreamingPreviewReady(name, argumentsJson);
  }
  return (
    hostToolArgumentsReadyForEarlyStreamingPreview(name, argumentsJson) ||
    hostToolArgumentsReadyForPreview(name, argumentsJson)
  );
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  reasoning: unknown,
  toolCalls: Map<string, StreamingToolCallAccumulator>,
  order: readonly string[],
): JsonValue {
  const functionToolCalls = order
    .map((toolCallId) => toolCalls.get(toolCallId))
    .filter((call): call is StreamingToolCallAccumulator => call !== undefined)
    .map((call) => ({
      id: call.toolCallId,
      type: 'function',
      function: {
        name: call.toolName,
        arguments: call.argumentsJson,
      },
    }));

  return withReasoningContentIfNeeded(
    withStoredBedrockReasoningPartsIfNeeded(
      {
        role: 'assistant',
        content: assistantContent || null,
        ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
      },
      normalizeAiSdkReasoningParts(reasoning),
    ),
    reasoningContent,
  );
}

function extractToolCallsFromStreamingMap(
  toolCalls: Map<string, StreamingToolCallAccumulator>,
  order: readonly string[],
): ToolCallRequest[] {
  return order
    .map((toolCallId) => toolCalls.get(toolCallId))
    .filter((call): call is StreamingToolCallAccumulator => call !== undefined)
    .filter((call) => call.toolName.trim().length > 0)
    .map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      argumentsJson: call.argumentsJson,
    }));
}

function extractToolCallsFromAiSdk(toolCalls: readonly AnthropicToolCall[]): ToolCallRequest[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    argumentsJson: JSON.stringify(toolCall.input),
  }));
}

function withReasoningContentIfNeeded(message: JsonObject, reasoningContent: string): JsonValue {
  if (messageContentHasEmbeddedThinking(message)) {
    return message;
  }

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

function withStoredBedrockReasoningPartsIfNeeded(
  message: JsonObject,
  reasoningParts: readonly JsonValue[],
): JsonObject {
  if (
    reasoningParts.length === 0 ||
    Array.isArray(message.reasoning_parts) ||
    Array.isArray(message.reasoningParts)
  ) {
    return message;
  }

  return {
    ...message,
    reasoning_parts: reasoningParts.map((part) => cloneJsonValue(part)),
  };
}

function messageContentHasEmbeddedThinking(message: JsonObject): boolean {
  if (typeof message.content !== 'string') {
    return false;
  }

  const trimmed = message.content.trimStart();
  return trimmed.startsWith('<think>') && trimmed.includes('</think>');
}

function extractAssistantReasoningContentFromJson(message: JsonObject): string {
  const storedReasoning = [message.reasoning_content, message.reasoningContent, message.reasoning, message.thinking]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');

  if (storedReasoning.length > 0) {
    return storedReasoning;
  }

  return extractStoredBedrockReasoningParts(message)
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter((value) => value.length > 0)
    .join('');
}

function normalizeAiSdkReasoningParts(reasoning: unknown): JsonValue[] {
  if (!Array.isArray(reasoning)) {
    return [];
  }

  return reasoning.flatMap((part) => {
    if (!isJsonObject(part) || part.type !== 'reasoning') {
      return [];
    }

    const text = typeof part.text === 'string' ? part.text : '';
    const providerOptions = normalizeBedrockReasoningProviderOptions(part.providerMetadata);
    if (text.length === 0 && providerOptions === undefined) {
      return [];
    }

    return [{
      type: 'reasoning',
      text,
      ...(providerOptions === undefined ? {} : { providerOptions }),
    } satisfies JsonObject];
  });
}

function extractStoredBedrockReasoningParts(message: JsonObject): Array<Record<string, unknown>> {
  const storedParts = Array.isArray(message.reasoning_parts)
    ? message.reasoning_parts
    : Array.isArray(message.reasoningParts)
      ? message.reasoningParts
      : [];

  return storedParts.flatMap((part) => {
    if (!isJsonObject(part) || part.type !== 'reasoning') {
      return [];
    }

    const text = typeof part.text === 'string' ? part.text : '';
    const providerOptions = normalizeBedrockReasoningProviderOptions(
      part.providerOptions ??
        part.provider_options ??
        part.providerMetadata ??
        part.provider_metadata,
    );
    if (text.length === 0 && providerOptions === undefined) {
      return [];
    }

    return [{
      type: 'reasoning',
      text,
      ...(providerOptions === undefined ? {} : { providerOptions }),
    }];
  });
}

function normalizeBedrockReasoningProviderOptions(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value as JsonValue | undefined)) {
    return undefined;
  }

  const metadata = value as JsonObject;
  const bedrock = metadata.bedrock;
  if (!isJsonObject(bedrock as JsonValue | undefined)) {
    return undefined;
  }
  const bedrockMetadataValue = bedrock as JsonObject;

  const bedrockMetadata: JsonObject = {};
  if (
    typeof bedrockMetadataValue.signature === 'string' &&
    bedrockMetadataValue.signature.length > 0
  ) {
    bedrockMetadata.signature = bedrockMetadataValue.signature;
  }
  if (
    typeof bedrockMetadataValue.redactedData === 'string' &&
    bedrockMetadataValue.redactedData.length > 0
  ) {
    bedrockMetadata.redactedData = bedrockMetadataValue.redactedData;
  }

  if (Object.keys(bedrockMetadata).length === 0) {
    return undefined;
  }

  return {
    bedrock: bedrockMetadata,
  };
}

function tryCountContentLines(argumentsJson: string): number | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }

    const candidate = parsed.content ?? parsed.new_text;
    if (typeof candidate !== 'string') {
      return undefined;
    }

    return candidate.split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

function llmHistoryToToolStateMessages(history: LlmMessage[], assetRoot = process.cwd()): JsonValue[] {
  return history.map((message) => llmMessageToToolStateMessage(message, assetRoot));
}

function llmMessageToToolStateMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    return {
      ...llmMessageProviderState(message),
      role: 'assistant',
      content: llmMessageTextContent(message.content),
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
    };
  }

  if (message.role === 'user' && message.content.some((part) => part.type === 'image')) {
    const parts: JsonValue[] = [];

    for (const part of message.content) {
      if (part.type === 'text' && part.text.length > 0) {
        parts.push({ type: 'text', text: part.text });
        continue;
      }

      if (part.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: {
            url: pathToImageUrl(part.path, assetRoot),
          },
        });
      }
    }

    if (parts.length === 0) {
      return { role: message.role, content: '' };
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  return {
    ...llmMessageProviderState(message),
    role: message.role,
    content: llmMessageTextContent(message.content),
    ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
  };
}

function llmMessageProviderState(message: LlmMessage): JsonObject {
  if (message.providerState === undefined) {
    return {};
  }

  return cloneJsonValue(message.providerState) as JsonObject;
}

function pathToImageUrl(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('file://')
  ) {
    return normalized;
  }

  const absolutePath = isAbsolute(normalized) ? normalized : resolve(assetRoot, normalized);
  const mime = guessImageMimeFromPath(absolutePath);

  try {
    const bytes = readFileSync(absolutePath);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return toFileUrl(absolutePath);
  }
}

function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function guessImageMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

function renderAiSdkError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function isFunctionToolDefinition(value: JsonValue): value is OpenAiStyleFunctionToolDefinition {
  return isJsonObject(value) && value.type === 'function' && isJsonObject(value.function);
}

function hasNonEmptyToolCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonEmptyToolCallIdOrUndefined(value: unknown): string | undefined {
  return hasNonEmptyToolCallId(value) ? value : undefined;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function trimLeadingStreamLineBreaks(existingText: string, nextText: string): string {
  if (existingText.length > 0) {
    return nextText;
  }

  return nextText.replace(/^[\r\n]+/u, '');
}

async function* emptyEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}

function isAnthropicToolCallStreamingStartPart(
  part: TextStreamPart<any>,
): part is TextStreamPart<any> & AnthropicToolCallStreamingStartPart {
  return (part as { type?: unknown }).type === 'tool-call-streaming-start'
    && typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
    && typeof (part as { toolName?: unknown }).toolName === 'string';
}

function isAnthropicToolCallDeltaPart(
  part: TextStreamPart<any>,
): part is TextStreamPart<any> & AnthropicToolCallDeltaPart {
  return (part as { type?: unknown }).type === 'tool-call-delta'
    && typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
    && typeof (part as { toolName?: unknown }).toolName === 'string'
    && typeof (part as { argsTextDelta?: unknown }).argsTextDelta === 'string';
}
