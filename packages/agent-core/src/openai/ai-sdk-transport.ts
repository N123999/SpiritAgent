import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

import {
  createAlibaba,
} from '@ai-sdk/alibaba';
import {
  createDeepSeek,
  type DeepSeekLanguageModelOptions,
} from '@ai-sdk/deepseek';
import {
  createOpenAICompatible,
  type OpenAICompatibleLanguageModelChatOptions,
} from '@ai-sdk/openai-compatible';
import {
  generateImage as generateAiImage,
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type TextStreamPart,
} from 'ai';

import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  createLlmMessageContentFromTextAndImages,
  llmMessageHasImages,
  llmMessageTextContent,
} from '../ports.js';
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
import {
  COMPACT_SUMMARY_PREFIX,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from '../tool-agent.js';
import {
  buildOpenAiRequestTrace,
  openAiReasoningEffort,
  openAiVendorChatCompletionBodyExtras,
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiImageGenerationConfig,
  type OpenAiTransportConfig,
} from './openai-compat.js';
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
  type OpenAiJsonSchemaTransport,
} from './json-schema.js';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

type AiSdkToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type OpenAiFunctionToolDefinition = JsonObject & {
  type: 'function';
  function: JsonObject;
};

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  type: 'function';
  functionName: string;
  functionArguments: string;
  readyPreviewEmitted: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export class AiSdkOpenAiCompatibleTransport
  implements LlmTransport<OpenAiTransportConfig, ToolAgentState>, OpenAiJsonSchemaTransport
{
  async generateImage(
    config: OpenAiTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput> {
    const imageConfig = config.imageGeneration;
    if (!imageConfig) {
      throw new Error('No image generation model is configured.');
    }

    const requestUrl = buildAiSdkImageGenerationUrl(imageConfig);
    logAiSdkImageGenerationStart(imageConfig, request, requestUrl);

    let result: Awaited<ReturnType<typeof generateAiImage>>;
    try {
      // TODO: If we later add image models that do not use OpenAI Images-compatible
      // endpoints, do not blindly forward WIDTHxHEIGHT. Translate this shared size
      // field per selected provider/model instead.
      result = await generateAiImage({
        model: createAiSdkImageModel(imageConfig),
        prompt: request.prompt,
        size: request.size as `${number}x${number}`,
        maxRetries: 0,
      });
    } catch (error) {
      logAiSdkImageGenerationFailure(imageConfig, request, requestUrl, error);
      throw error;
    }

    const image = result.image;
    const saved = await saveGeneratedImage({
      data: image.uint8Array,
      mediaType: image.mediaType,
      prompt: request.prompt,
      model: imageConfig.model,
    });

    logAiSdkImageGenerationSuccess(imageConfig, requestUrl, saved);

    const summaryText = [
      '[generated image]',
      `path: ${saved.path}`,
      `mime_type: ${saved.mimeType}`,
      `model: ${imageConfig.model}`,
    ].join('\n');

    return {
      content: createLlmMessageContentFromTextAndImages(summaryText, [saved.path]),
      summaryText,
    };
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const messages = normalizeMessagesForRequest(
      config,
      buildJsonSchemaCompletionMessages(config, request),
    );
    const requestTrace = buildAiSdkRequestTrace(config, 1, messages, []);

    try {
      const result = await generateObject({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(messages) as any,
        allowSystemInMessages: true,
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildAiSdkProviderOptions(config),
        maxRetries: 0,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderAiSdkOpenAiError(error));
    }
  }

  async startToolAgentRound(
    config: OpenAiTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = normalizeMessagesForRequest(config, nextState.messages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const tracedRequest = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    try {
      const result: any = await generateText({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildAiSdkProviderOptions(config),
        maxRetries: 0,
      });

      const assistantMessage = buildAssistantMessageFromGenerateTextResult(
        result.response.body,
        result.text,
        result.toolCalls,
      );
      nextState.messages.push(assistantMessage);

      const calls = extractToolCallsFromAiSdk(result.toolCalls);
      if (calls.length > 0) {
        return {
          kind: 'success',
          result: {
            state: nextState,
            step: {
              kind: 'tool-calls',
              calls,
            },
            requestTrace: tracedRequest,
          },
        };
      }

      return {
        kind: 'success',
        result: {
          state: nextState,
          step: {
            kind: 'final-response-ready',
          },
          requestTrace: tracedRequest,
        },
      };
    } catch (error) {
      return {
        kind: 'failure',
        error: renderAiSdkOpenAiError(error),
        requestTrace: tracedRequest,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenAiTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = normalizeMessagesForRequest(config, nextState.messages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const requestTrace = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );

    const abortController = new AbortController();

    try {
      const result: any = streamText({
        model: createAiSdkLanguageModel(config),
        messages: openAiMessagesToAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildAiSdkProviderOptions(config),
        includeRawChunks: true,
        maxRetries: 0,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      return {
        eventStream: aiSdkEventStreamToRuntimeEvents(
          result.fullStream,
          nextState,
          requestTrace,
          completion,
          isDeepSeekOfficialAiSdkProvider(config),
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyAiSdkEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: renderAiSdkOpenAiError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: OpenAiTransportConfig,
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

    const promptMessages = openAiMessagesToAiSdkMessages([
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
            const imageNote = llmMessageHasImages(message.content) ? '\n[images attached]' : '';
            return `${message.role.toUpperCase()}: ${text}${imageNote}`;
          })
          .join('\n\n'),
      },
    ]);
    const compactConfig: OpenAiTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createAiSdkLanguageModel(compactConfig),
          messages: promptMessages as any,
          allowSystemInMessages: true,
          providerOptions: buildAiSdkProviderOptions(compactConfig),
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
        model: createAiSdkLanguageModel(compactConfig),
        messages: promptMessages as any,
        allowSystemInMessages: true,
        providerOptions: buildAiSdkProviderOptions(compactConfig),
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
      droppedMessages: saturatingSub(beforeLength, 1),
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
    return llmHistoryToOpenAiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt('—'),
    };
  }
}

function buildAiSdkRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const requestTrace = buildOpenAiRequestTrace(config, stepIndex, messages, tools, stream);
  if (!isDeepSeekOfficialAiSdkProvider(config) && !isAlibabaOfficialAiSdkProvider(config)) {
    return requestTrace;
  }

  const firstTrace = requestTrace[0];
  if (!isJsonObject(firstTrace)) {
    return requestTrace;
  }

  return [
    {
      ...firstTrace,
      kind: isDeepSeekOfficialAiSdkProvider(config)
        ? 'deepseek_sdk_chat_completions'
        : 'alibaba_sdk_chat_completions',
    },
    ...requestTrace.slice(1),
  ];
}

function createAiSdkLanguageModel(config: OpenAiTransportConfig): any {
  if (isDeepSeekOfficialAiSdkProvider(config)) {
    return createAiSdkDeepSeekProvider(config).chat(config.model);
  }

  if (isAlibabaOfficialAiSdkProvider(config)) {
    return createAiSdkAlibabaProvider(config).chatModel(config.model);
  }

  return createAiSdkOpenAiCompatibleProvider(config).chatModel(config.model);
}

function createAiSdkImageModel(config: OpenAiImageGenerationConfig): any {
  return createAiSdkOpenAiCompatibleProvider(config, { includeChatVendorExtras: false }).imageModel(config.model);
}

function createAiSdkOpenAiCompatibleProvider(
  config: OpenAiTransportConfig | OpenAiImageGenerationConfig,
  options: { includeChatVendorExtras?: boolean } = {},
) {
  const vendorExtras = options.includeChatVendorExtras === false
    ? {}
    : openAiVendorChatCompletionBodyExtras(config as OpenAiTransportConfig);
  const fetchWrapper =
    Object.keys(vendorExtras).length === 0
      ? undefined
      : async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = tryParseRequestBody(init?.body);
          if (!isJsonObject(body)) {
            return fetch(input, init);
          }

          return fetch(input, {
            ...init,
            body: JSON.stringify({
              ...body,
              ...vendorExtras,
            }),
          });
        };

  const headers = {
    ...(config.organization ? { 'OpenAI-Organization': config.organization } : {}),
    ...(config.project ? { 'OpenAI-Project': config.project } : {}),
  };

  return createOpenAICompatible({
    apiKey: config.apiKey,
    name: 'openai',
    baseURL: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    supportsStructuredOutputs: true,
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(fetchWrapper ? { fetch: fetchWrapper } : {}),
  });
}

function createAiSdkDeepSeekProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const fetchWrapper =
    reasoningEffort === undefined
      ? undefined
      : async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = tryParseRequestBody(init?.body);
          if (!isJsonObject(body)) {
            return fetch(input, init);
          }

          return fetch(input, {
            ...init,
            body: JSON.stringify({
              ...body,
              reasoning_effort: reasoningEffort,
            }),
          });
        };

  return createDeepSeek({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(fetchWrapper ? { fetch: fetchWrapper } : {}),
  });
}

function createAiSdkAlibabaProvider(config: OpenAiTransportConfig) {
  return createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
}

function buildAiSdkProviderOptions(
  config: OpenAiTransportConfig,
): Record<string, JsonObject> {
  if (isDeepSeekOfficialAiSdkProvider(config)) {
    const deepseekOptions = {
      thinking: {
        type: config.vendorExtendedThinking === false ? 'disabled' : 'enabled',
      },
    } satisfies DeepSeekLanguageModelOptions;

    return {
      deepseek: deepseekOptions as JsonObject,
    };
  }

  const reasoningEffort = openAiReasoningEffort(config) as
    | OpenAICompatibleLanguageModelChatOptions['reasoningEffort']
    | undefined;

  if (reasoningEffort === undefined) {
    return {};
  }

  return {
    openai: {
      reasoningEffort,
    } as JsonObject,
  };
}

function normalizeToolDefinitions(tools: JsonValue): OpenAiFunctionToolDefinition[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isFunctionToolDefinition)
    .map((toolDefinition) => cloneJsonValue(toolDefinition) as OpenAiFunctionToolDefinition);
}

function buildAiSdkTools(normalizedTools: OpenAiFunctionToolDefinition[]): Record<string, ReturnType<typeof tool>> {
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

function openAiMessagesToAiSdkMessages(messages: JsonValue[]): Array<Record<string, unknown>> {
  const toolCallNames = buildToolCallNameIndex(messages);

  return messages.flatMap((message) => {
    if (!isJsonObject(message) || typeof message.role !== 'string') {
      return [];
    }

    switch (message.role) {
      case 'system': {
        return typeof message.content === 'string'
          ? [{ role: 'system', content: message.content }]
          : [];
      }
      case 'user': {
        const content = openAiUserContentToAiSdkContent(message.content);
        return content === undefined ? [] : [{ role: 'user', content }];
      }
      case 'assistant': {
        const assistantMessage = openAiAssistantMessageToAiSdkMessage(message);
        return assistantMessage === undefined ? [] : [assistantMessage];
      }
      case 'tool': {
        const toolMessage = openAiToolMessageToAiSdkMessage(message, toolCallNames);
        return toolMessage === undefined ? [] : [toolMessage];
      }
      default:
        return [];
    }
  });
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

function openAiAssistantMessageToAiSdkMessage(
  message: JsonObject,
): Record<string, unknown> | undefined {
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

function openAiToolMessageToAiSdkMessage(
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
  responseBody: unknown,
  text: string,
  toolCalls: readonly AiSdkToolCall[],
): JsonValue {
  const assistantMessage = extractAssistantMessageFromChatResponseBody(responseBody);
  if (assistantMessage) {
    return normalizeRawAssistantMessage(assistantMessage);
  }

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
    '',
  );
}

function extractAssistantMessageFromChatResponseBody(responseBody: unknown): JsonObject | undefined {
  if (!isJsonObjectUnknown(responseBody) || !Array.isArray(responseBody.choices)) {
    return undefined;
  }

  const firstChoice = responseBody.choices[0];
  if (!isJsonObject(firstChoice) || !isJsonObject(firstChoice.message)) {
    return undefined;
  }

  return firstChoice.message;
}

function normalizeRawAssistantMessage(message: JsonObject): JsonValue {
  const functionToolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter(isJsonObject)
        .filter((toolCall) => toolCall.type === 'function' && isJsonObject(toolCall.function))
        .map((toolCall) => cloneJsonValue(toolCall))
    : [];
  const reasoningContent = extractAssistantReasoningContentFromJson(message);

  return withReasoningContentIfNeeded(
    {
      role: 'assistant',
      content: typeof message.content === 'string' || message.content === null ? message.content : null,
      ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
    },
    reasoningContent,
  );
}

async function* aiSdkEventStreamToRuntimeEvents(
  stream: AsyncIterable<TextStreamPart<any>>,
  nextState: ToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<ToolAgentState>>,
  useStructuredReasoningEvents: boolean,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<number, AggregatedStreamingToolCall>();
  let assistantContent = '';
  let reasoningContent = '';
  let sawAnswerOrToolOutput = false;
  const rawPreview: string[] = [];

  try {
    for await (const part of stream) {
      if (part.type === 'raw' && rawPreview.length < 8) {
        rawPreview.push(truncateChars(JSON.stringify(part.rawValue), 320));
      }

      switch (part.type) {
        case 'reasoning-delta': {
          reasoningContent += part.text;
          yield { kind: 'thinking-chunk', text: part.text };
          break;
        }
        case 'text-delta': {
          sawAnswerOrToolOutput = true;
          assistantContent += part.text;
          yield { kind: 'assistant-chunk', text: part.text };
          break;
        }
        case 'tool-call': {
          sawAnswerOrToolOutput = true;
          break;
        }
        case 'error': {
          throw part.error;
        }
        case 'raw': {
          if (!useStructuredReasoningEvents) {
            const thinkingText = extractFallbackStreamingThinkingTextFromRawChunk(part.rawValue);
            if (thinkingText) {
              reasoningContent += thinkingText;
              yield { kind: 'thinking-chunk', text: thinkingText };
            }
          }

          const rawToolUpdates = accumulateStreamingToolCallProgressFromRawChunk(
            toolCalls,
            part.rawValue,
          );
          if (rawToolUpdates.length > 0) {
            sawAnswerOrToolOutput = true;
            for (const update of rawToolUpdates) {
              yield update;
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      const preview = rawPreview.length === 0 ? '<empty stream body>' : rawPreview.join('\n');
      throw new Error(`流式响应无任何 delta（无 content / tool_calls）。预览:\n${truncateChars(preview, 600)}`);
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(assistantContent, reasoningContent, toolCalls),
    );
    const calls = extractToolCallsFromAggregatedMap(toolCalls);
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
    const rendered = renderAiSdkOpenAiError(error);
    completion.resolve({
      kind: 'failure',
      error: rendered,
      requestTrace,
    });
    yield {
      kind: 'error',
      error: rendered,
    };
  }
}

function extractFallbackStreamingThinkingTextFromRawChunk(rawValue: unknown): string | undefined {
  if (!isJsonObjectUnknown(rawValue) || !Array.isArray(rawValue.choices)) {
    return undefined;
  }

  const chunks = rawValue.choices
    .filter(isJsonObject)
    .map((choice) => choice.delta)
    .filter(isJsonObject)
    .flatMap((delta) => [
      delta.reasoningText,
      delta.reasoning_text,
      delta.thinking,
    ])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');

  return chunks || undefined;
}

function accumulateStreamingToolCallProgressFromRawChunk(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  rawValue: unknown,
): LlmStreamEvent[] {
  if (!isJsonObjectUnknown(rawValue) || !Array.isArray(rawValue.choices)) {
    return [];
  }

  const updates: LlmStreamEvent[] = [];
  for (const choice of rawValue.choices) {
    if (!isJsonObject(choice) || !isJsonObject(choice.delta) || !Array.isArray(choice.delta.tool_calls)) {
      continue;
    }

    for (const delta of choice.delta.tool_calls) {
      if (!isJsonObject(delta) || typeof delta.index !== 'number') {
        continue;
      }

      const existing = toolCalls.get(delta.index);
      const current: AggregatedStreamingToolCall = existing ?? {
        index: delta.index,
        id: nonEmptyToolCallIdOrUndefined(delta.id) ?? `stream-tool-call-${delta.index}`,
        type: 'function',
        functionName: '',
        functionArguments: '',
        readyPreviewEmitted: false,
      };

      // Alibaba/Qwen 的流式 tool_call delta 可能先给合法 id，随后又回传空字符串；这里只接受非空更新，避免把已存在的稳定 id 覆盖掉。
      const nextToolCallId = nonEmptyToolCallIdOrUndefined(delta.id);
      if (nextToolCallId) {
        current.id = nextToolCallId;
      }

      if (isJsonObject(delta.function) && typeof delta.function.name === 'string') {
        current.functionName += delta.function.name;
      }
      if (isJsonObject(delta.function) && typeof delta.function.arguments === 'string') {
        current.functionArguments += delta.function.arguments;
      }

      if (
        current.functionName &&
        !current.readyPreviewEmitted &&
        hostToolArgumentsReadyForPreview(current.functionName, current.functionArguments)
      ) {
        const previewLine = buildToolProgressPreview(current.functionName, current.functionArguments);
        updates.push({
          kind: 'streaming-tool-preview',
          toolCallId: current.id,
          toolName: current.functionName,
          argumentsJson: current.functionArguments,
          previewLine,
        });
        current.readyPreviewEmitted = true;
      }

      toolCalls.set(delta.index, current);
    }
  }

  return updates;
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): JsonValue {
  const functionToolCalls = [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map((call) => ({
      index: call.index,
      id: call.id,
      type: call.type,
      function: {
        name: call.functionName,
        arguments: call.functionArguments,
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

function extractToolCallsFromAggregatedMap(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): ToolCallRequest[] {
  return [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .filter((call) => call.functionName.trim().length > 0)
    .map((call) => ({
      id: call.id,
      name: call.functionName,
      argumentsJson: call.functionArguments,
    }));
}

function extractToolCallsFromAiSdk(toolCalls: readonly AiSdkToolCall[]): ToolCallRequest[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    argumentsJson: JSON.stringify(toolCall.input),
  }));
}

function withReasoningContentIfNeeded(
  message: JsonObject,
  reasoningContent: string,
): JsonValue {
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
  return [
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
  ]
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

function llmHistoryToOpenAiMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonValue[] {
  return history.map((message) => llmMessageToOpenAiMessage(message, assetRoot));
}

function llmMessageToOpenAiMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (message.role === 'user' && llmMessageHasImages(message.content)) {
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

function normalizeMessagesForRequest(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'modelCapabilities'>,
  messages: JsonValue[],
): JsonValue[] {
  const profile = resolveOpenAiModelCompatibilityProfile(config);
  return messages.map((message) => sanitizeMessageForCompatibility(message, profile));
}

function sanitizeMessageForCompatibility(
  message: JsonValue,
  profile: ReturnType<typeof resolveOpenAiModelCompatibilityProfile>,
): JsonValue {
  const cloned = cloneJsonValue(message);
  if (!isJsonObject(cloned) || cloned.role !== 'user' || !Array.isArray(cloned.content)) {
    return cloned;
  }

  if (profile.hasExplicitCapabilities && !profile.capabilities.vision) {
    const textParts = cloned.content.filter(
      (part) => isJsonObject(part) && part.type === 'text' && typeof part.text === 'string',
    );
    return {
      ...cloned,
      content:
        textParts.length > 0
          ? textParts
          : '',
    };
  }

  return cloned;
}

function isDeepSeekOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'deepseek';
}

function isAlibabaOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'alibaba';
}

function buildAiSdkImageGenerationUrl(config: OpenAiImageGenerationConfig): string {
  const baseUrl = (config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL).replace(/\/$/, '');
  return `${baseUrl}/images/generations`;
}

function logAiSdkImageGenerationStart(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  requestUrl: string,
): void {
  console.error('[agent-core][generate-image] request.start', {
    adapter: 'openai-compatible-image',
    vendor: config.llmVendor ?? 'custom',
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    requestUrl,
    size: request.size,
    usedDefaultSize: request.size === DEFAULT_IMAGE_GENERATION_SIZE,
    promptPreview: truncateChars(singleLine(request.prompt), 160),
  });
}

function logAiSdkImageGenerationSuccess(
  config: OpenAiImageGenerationConfig,
  requestUrl: string,
  saved: GeneratedImageFile,
): void {
  console.error('[agent-core][generate-image] request.success', {
    adapter: 'openai-compatible-image',
    vendor: config.llmVendor ?? 'custom',
    model: config.model,
    requestUrl,
    savedPath: saved.path,
    mimeType: saved.mimeType,
  });
}

function logAiSdkImageGenerationFailure(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  requestUrl: string,
  error: unknown,
): void {
  console.error('[agent-core][generate-image] request.failed', {
    adapter: 'openai-compatible-image',
    vendor: config.llmVendor ?? 'custom',
    model: config.model,
    baseUrl: config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    requestUrl,
    size: request.size,
    usedDefaultSize: request.size === DEFAULT_IMAGE_GENERATION_SIZE,
    promptPreview: truncateChars(singleLine(request.prompt), 160),
    ...describeAiSdkErrorForDebug(error),
  });
}

function describeAiSdkErrorForDebug(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      errorType: typeof error,
      errorMessage: String(error),
    };
  }

  const candidate = error as Error & {
    url?: unknown;
    statusCode?: unknown;
    responseBody?: unknown;
    responseHeaders?: unknown;
    data?: unknown;
    cause?: unknown;
  };

  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(typeof candidate.url === 'string' ? { errorUrl: candidate.url } : {}),
    ...(typeof candidate.statusCode === 'number' ? { statusCode: candidate.statusCode } : {}),
    ...(candidate.responseBody !== undefined
      ? { responseBodyPreview: truncateChars(stringifyDebugValue(candidate.responseBody), 4000) }
      : {}),
    ...(candidate.responseHeaders !== undefined
      ? { responseHeaders: normalizeDebugValue(candidate.responseHeaders) }
      : {}),
    ...(candidate.data !== undefined ? { errorData: normalizeDebugValue(candidate.data) } : {}),
    ...(candidate.cause !== undefined
      ? { errorCause: truncateChars(stringifyDebugValue(candidate.cause), 1000) }
      : {}),
    ...(error.stack ? { stackPreview: truncateChars(error.stack, 2000) } : {}),
  };
}

function normalizeDebugValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return stringifyDebugValue(value);
  }
}

function stringifyDebugValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function renderAiSdkOpenAiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function tryParseRequestBody(body: BodyInit | null | undefined): JsonValue | undefined {
  if (typeof body !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(body) as JsonValue;
  } catch {
    return undefined;
  }
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

function isFunctionToolDefinition(value: JsonValue): value is OpenAiFunctionToolDefinition {
  return isJsonObject(value) && value.type === 'function' && isJsonObject(value.function);
}

function isJsonObjectUnknown(value: unknown): value is JsonObject {
  return isJsonObject(value as JsonValue | undefined);
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  return `${chars.slice(0, maxChars).join('')}...`;
}

function hasNonEmptyToolCallId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonEmptyToolCallIdOrUndefined(value: unknown): string | undefined {
  return hasNonEmptyToolCallId(value) ? value : undefined;
}

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
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

async function* emptyAiSdkEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}
