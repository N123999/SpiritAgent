import { readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';

import { createAnthropic } from '@ai-sdk/anthropic';
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
import {
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
  buildAnthropicProviderOptions,
  buildAnthropicRequestTrace,
  DEFAULT_ANTHROPIC_BASE_URL,
  type AnthropicTransportConfig,
} from './anthropic-compat.js';

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

export class AiSdkAnthropicTransport
  implements LlmTransport<AnthropicTransportConfig, ToolAgentState>, JsonSchemaTransport
{
  async generateImage(
    _config: AnthropicTransportConfig,
    _request: ImageGenerationRequest,
    _saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    throw new Error('Anthropic transport does not support image generation.');
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: AnthropicTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const messages = buildJsonSchemaCompletionMessages(
      { model: config.model },
      request,
    );
    const requestTrace = buildAnthropicRequestTrace(config, 1, messages, []);

    try {
      const result = await generateObject({
        model: createAnthropicLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(messages) as any,
        allowSystemInMessages: true,
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildAnthropicProviderOptions(config),
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
    config: AnthropicTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildAnthropicRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    try {
      const result: any = await generateText({
        model: createAnthropicLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildAnthropicProviderOptions(config),
        maxRetries: 0,
      });

      nextState.messages.push(
        buildAssistantMessageFromGenerateTextResult(
          result.text,
          typeof result.reasoningText === 'string' ? result.reasoningText : '',
          result.toolCalls,
        ),
      );

      const calls = extractToolCallsFromAiSdk(result.toolCalls);
      if (calls.length > 0) {
        return {
          kind: 'success',
          result: {
            state: nextState,
            step: { kind: 'tool-calls', calls },
            requestTrace,
          },
        };
      }

      return {
        kind: 'success',
        result: {
          state: nextState,
          step: { kind: 'final-response-ready' },
          requestTrace,
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
    config: AnthropicTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildAnthropicRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );
    const abortController = new AbortController();

    try {
      const result: any = streamText({
        model: createAnthropicLanguageModel(config),
        messages: toolStateMessagesToAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildAnthropicProviderOptions(config),
        includeRawChunks: false,
        maxRetries: 0,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      return {
        eventStream: anthropicEventStreamToRuntimeEvents(
          result.fullStream,
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
    config: AnthropicTransportConfig,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
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

    const promptMessages = toolStateMessagesToAiSdkMessages([
      {
        role: 'system',
        content: [
          '请将以下对话压缩为后续推理可复用的系统摘要。',
          '保留：用户目标、关键约束、已验证结论、失败尝试、未完成事项。',
          '不要保留寒暄。',
          '输出纯文本摘要。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: history
          .map((message) => {
            const text = llmMessageTextContent(message.content);
            const imageNote = message.content.some((part) => part.type === 'image') ? '\n[images attached]' : '';
            return `${message.role.toUpperCase()}: ${text}${imageNote}`;
          })
          .join('\n\n'),
      },
    ]);
    const compactConfig: AnthropicTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createAnthropicLanguageModel(compactConfig),
          messages: promptMessages as any,
          allowSystemInMessages: true,
          providerOptions: buildAnthropicProviderOptions(compactConfig),
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
        model: createAnthropicLanguageModel(compactConfig),
        messages: promptMessages as any,
        allowSystemInMessages: true,
        providerOptions: buildAnthropicProviderOptions(compactConfig),
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
      content: [{ type: 'text', text: `[SPIRIT_COMPACT_SUMMARY]\n${normalizedSummary}` }],
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
          message.role === 'system' && llmMessageTextContent(message.content).startsWith('[SPIRIT_COMPACT_SUMMARY]'),
      )
      ?.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .slice('[SPIRIT_COMPACT_SUMMARY]'.length)
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
    return llmHistoryToToolStateMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt('—'),
    };
  }
}

function createAnthropicLanguageModel(config: AnthropicTransportConfig): any {
  return createAnthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL,
  }).chat(config.model);
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
  const reasoningText = extractAssistantReasoningContentFromJson(message);
  const toolCallParts = extractAssistantToolCallParts(message);
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
  toolCalls: readonly AnthropicToolCall[],
): JsonValue {
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
    reasoningText,
  );
}

async function* anthropicEventStreamToRuntimeEvents(
  stream: AsyncIterable<TextStreamPart<any>>,
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
        maybeEmitStreamingPreview(current);
        toolCalls.set(toolCallDelta.toolCallId, current);
        if (!toolCallOrder.includes(toolCallDelta.toolCallId)) {
          toolCallOrder.push(toolCallDelta.toolCallId);
        }
        if (current.readyPreviewEmitted) {
          yield {
            kind: 'streaming-tool-preview',
            toolCallId: current.toolCallId,
            toolName: current.toolName,
            argumentsJson: current.argumentsJson,
            previewLine: buildToolProgressPreview(current.toolName, current.argumentsJson),
          };
          current.readyPreviewEmitted = false;
        }
        continue;
      }

      switch (part.type) {
        case 'reasoning-delta':
          reasoningContent += part.text;
          yield { kind: 'thinking-chunk', text: part.text };
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
          if (hostToolArgumentsReadyForPreview(current.toolName, current.argumentsJson)) {
            yield {
              kind: 'streaming-tool-preview',
              toolCallId: current.toolCallId,
              toolName: current.toolName,
              argumentsJson: current.argumentsJson,
              previewLine: buildToolProgressPreview(current.toolName, current.argumentsJson),
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
      buildStreamingAssistantMessage(assistantContent, reasoningContent, toolCalls, toolCallOrder),
    );

    const calls = extractToolCallsFromStreamingMap(toolCalls, toolCallOrder);
    completion.resolve({
      kind: 'success',
      result: {
        state: nextState,
        step: calls.length > 0 ? { kind: 'tool-calls', calls } : { kind: 'final-response-ready' },
        requestTrace,
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

function maybeEmitStreamingPreview(current: StreamingToolCallAccumulator): void {
  if (
    current.readyPreviewEmitted ||
    !hostToolArgumentsReadyForPreview(current.toolName, current.argumentsJson)
  ) {
    return;
  }

  current.readyPreviewEmitted = true;
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
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
    {
      role: 'assistant',
      content: assistantContent || null,
      ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
    },
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

function messageContentHasEmbeddedThinking(message: JsonObject): boolean {
  if (typeof message.content !== 'string') {
    return false;
  }

  const trimmed = message.content.trimStart();
  return trimmed.startsWith('<think>') && trimmed.includes('</think>');
}

function extractAssistantReasoningContentFromJson(message: JsonObject): string {
  return [message.reasoning_content, message.reasoningContent, message.reasoning, message.thinking]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');
}

function buildToolProgressPreview(name: string, argumentsJson: string): string {
  const lineHint = tryCountContentLines(argumentsJson);
  if (lineHint !== undefined && lineHint > 0) {
    return `准备调用工具: ${name}（约 ${lineHint} 行内容）`;
  }

  return `准备调用工具: ${name}`;
}

function hostToolArgumentsReadyForPreview(name: string, argumentsJson: string): boolean {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(trimmed) as JsonValue;
  } catch {
    return false;
  }

  if (!isJsonObject(parsed)) {
    return false;
  }

  const nonEmpty = (key: string): boolean => {
    const value = parsed[key];
    return typeof value === 'string' && value.trim().length > 0;
  };

  switch (name) {
    case 'run_shell_command':
      return nonEmpty('command');
    case 'web_fetch':
      return nonEmpty('url');
    case 'list_directory_files':
      return nonEmpty('path');
    case 'read_file':
      return nonEmpty('path');
    case 'glob':
      return nonEmpty('pattern');
    case 'grep':
      return nonEmpty('query');
    case 'run_subagent':
      return nonEmpty('task');
    case 'create_file':
      return nonEmpty('path') && nonEmpty('content');
    case 'edit_file':
      return nonEmpty('path') && nonEmpty('old_text') && nonEmpty('new_text');
    case 'delete_file':
      return nonEmpty('path');
    case 'ask_questions':
      return Array.isArray(parsed.questions) && parsed.questions.length > 0;
    default:
      return Object.values(parsed).some(
        (value) => typeof value === 'string' && value.trim().length > 0,
      );
  }
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
    role: message.role,
    content: llmMessageTextContent(message.content),
  };
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
