import { basename } from 'node:path';

import {
  createAlibaba,
} from '@ai-sdk/alibaba';
import {
  createDeepSeek,
  type DeepSeekLanguageModelOptions,
} from '@ai-sdk/deepseek';
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProviderOptions,
} from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import {
  createMoonshotAI,
  type MoonshotAILanguageModelOptions,
} from '@ai-sdk/moonshotai';
import {
  createXai,
  type XaiLanguageModelChatOptions,
} from '@ai-sdk/xai';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
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
  resolveStreamingToolPreviewEmit,
  shouldEmitStreamingToolNamePreview,
} from '../tool-streaming-preview-gate.js';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  createLlmMessageContentFromTextAndImages,
  llmMessageTextContent,
} from '../ports.js';
import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ImageGenerationRequest,
  VideoGenerationRequest,
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
  buildCompactHistoryPromptMessages,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from '../tool-agent.js';
import { readAiSdkUsage } from '../ai-sdk-usage.js';
import { finishTaskStreamingPreviewReady } from '../finish-task-preview.js';
import {
  buildOpenAiRequestTrace,
  openAiReasoningEffort,
  openAiVendorChatCompletionBodyExtras,
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiImageGenerationConfig,
  type OpenAiTransportConfig,
  type OpenAiVideoGenerationConfig,
} from './openai-compat.js';
import { generateVideoWithRouter } from '../video-generation/router.js';
import { getLlmFetch } from '../llm-fetch.js';
import { createAlibabaChatCompletionsAwareFetch } from '../open-responses/alibaba-chat-completions-fetch.js';
import {
  buildAlibabaChatCompletionsExtraBody,
  shouldUseAlibabaChatCompletionsBuiltInTools,
} from '../open-responses/alibaba-built-in-tools.js';
import {
  clearMoonshotChatCompletionMessages,
  openAiMessagesContainVideoUrl,
  stashMoonshotChatCompletionMessages,
  takeMoonshotChatCompletionMessages,
} from './moonshot-chat-completion-messages.js';
import {
  llmHistoryToOpenAiMessages,
  resolveMoonshotVideoUrlsInOpenAiMessages,
} from './openai-multimodal-messages.js';
import { normalizeMoonshotApiBase } from './moonshot-files.js';
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
  type OpenAiJsonSchemaTransport,
} from './json-schema.js';

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const STREAMING_TOOL_CALL_PLACEHOLDER_PREFIX = 'stream-tool-call-';

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
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const MANAGED_GENERATED_ASSET_PROTOCOL = 'spirit-agent:';
const MANAGED_GENERATED_ASSET_HOST = 'generated';

export function normalizeGeneratedImageMarkdownRef(markdownRef: string): string {
  const trimmed = markdownRef.trim();
  if (!trimmed) {
    throw new Error('Host returned an empty generated image markdownRef.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Host returned an invalid generated image markdownRef.');
  }

  if (
    url.protocol.toLowerCase() !== MANAGED_GENERATED_ASSET_PROTOCOL ||
    url.hostname.toLowerCase() !== MANAGED_GENERATED_ASSET_HOST ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('Host returned an invalid generated image markdownRef.');
  }

  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== 'image') {
    throw new Error('Host returned an invalid generated image markdownRef.');
  }

  let imageId: string;
  try {
    imageId = decodeURIComponent(segments[1] ?? '').trim();
  } catch {
    throw new Error('Host returned an invalid generated image markdownRef.');
  }

  if (
    !imageId ||
    imageId !== basename(imageId) ||
    imageId === '.' ||
    imageId === '..' ||
    imageId.includes('/') ||
    imageId.includes('\\')
  ) {
    throw new Error('Host returned an invalid generated image markdownRef.');
  }

  return `spirit-agent://generated/image/${encodeURIComponent(imageId)}`;
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

    const summaryLines = ['[generated image]'];
    const markdownRef = normalizeGeneratedImageMarkdownRef(saved.markdownRef);
    summaryLines.push(
      `image_ref: ${markdownRef}`,
      `read_file_path: ${markdownRef}`,
      `embed_markdown: ![Generated image](${markdownRef})`,
    );
    summaryLines.push(`mime_type: ${saved.mimeType}`, `model: ${imageConfig.model}`);
    const summaryText = summaryLines.join('\n');

    return {
      content: createLlmMessageContentFromTextAndImages(summaryText, [saved.path]),
      summaryText,
    };
  }

  async generateVideo(
    config: OpenAiTransportConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const videoConfig = config.videoGeneration;
    if (!videoConfig) {
      throw new Error('No video generation model is configured.');
    }

    return generateVideoWithRouter(videoConfig, request, saveGeneratedVideo);
  }

  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const rawMessages = buildJsonSchemaCompletionMessages(config, request);
    await resolveMoonshotVideoUrlsInOpenAiMessages(
      config,
      rawMessages,
      openAiTransportAssetRoot(config),
    );
    const messages = normalizeMessagesForRequest(config, rawMessages);
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

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      config,
      nextState.messages,
      openAiTransportAssetRoot(config),
    );
    const requestMessages = normalizeMessagesForRequest(config, nextState.messages);
    const normalizedTools = normalizeToolDefinitions(tools);
    const tracedRequest = buildAiSdkRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    prepareMoonshotChatCompletionRequest(config, requestMessages);
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

      const usage = await readAiSdkUsage(result);
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
            ...(usage ? { usage } : {}),
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
          ...(usage ? { usage } : {}),
        },
      };
    } catch (error) {
      return {
        kind: 'failure',
        error: renderAiSdkOpenAiError(error),
        requestTrace: tracedRequest,
      };
    } finally {
      clearMoonshotChatCompletionRequest(config);
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

    await resolveMoonshotVideoUrlsInOpenAiMessages(
      config,
      nextState.messages,
      openAiTransportAssetRoot(config),
    );
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

    // Moonshot 视频：须在 streamText 异步发起 HTTP 之后再清理 stash，不可在同步 finally 里清理。
    prepareMoonshotChatCompletionRequest(config, requestMessages);
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

      const completionPromise = completion.promise.finally(() => {
        clearMoonshotChatCompletionRequest(config);
      });

      return {
        eventStream: aiSdkEventStreamToRuntimeEvents(
          result.fullStream,
          result,
          nextState,
          requestTrace,
          completion,
          usesStructuredReasoningStreamEvents(config),
        ),
        completion: completionPromise,
        cancel: () => {
          abortController.abort();
          clearMoonshotChatCompletionRequest(config);
        },
      };
    } catch (error) {
      clearMoonshotChatCompletionRequest(config);
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

    const promptMessages = openAiMessagesToAiSdkMessages(
      buildCompactHistoryPromptMessages(history, {
        ...(context?.preCompactionArchivePath === undefined
          ? {}
          : { preCompactionArchivePath: context.preCompactionArchivePath }),
      }),
    );
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
  if (
    !isDeepSeekOfficialAiSdkProvider(config) &&
    !isXaiOfficialAiSdkProvider(config) &&
    !isMoonshotOfficialAiSdkProvider(config) &&
    !isAlibabaOfficialAiSdkProvider(config) &&
    !isVercelAiGatewayProvider(config) &&
    !isOpenAiOfficialAiSdkProvider(config) &&
    !isGoogleOfficialAiSdkProvider(config) &&
    !isGoogleVertexOfficialAiSdkProvider(config)
  ) {
    return requestTrace;
  }

  const firstTrace = requestTrace[0];
  if (!isJsonObject(firstTrace)) {
    return requestTrace;
  }

  const kind = isDeepSeekOfficialAiSdkProvider(config)
    ? 'deepseek_sdk_chat_completions'
    : isXaiOfficialAiSdkProvider(config)
      ? 'xai_sdk_chat_completions'
      : isMoonshotOfficialAiSdkProvider(config)
        ? 'moonshot_sdk_chat_completions'
        : isAlibabaOfficialAiSdkProvider(config)
          ? 'alibaba_sdk_chat_completions'
          : isVercelAiGatewayProvider(config)
            ? 'gateway_sdk_chat_completions'
            : isGoogleVertexOfficialAiSdkProvider(config)
              ? 'google_vertex_sdk_generate_content'
              : isGoogleOfficialAiSdkProvider(config)
                ? 'google_sdk_generate_content'
                : 'openai_official_sdk_chat_completions';

  const alibabaExtraBody = isAlibabaOfficialAiSdkProvider(config)
    && shouldUseAlibabaChatCompletionsBuiltInTools(config)
    ? buildAlibabaChatCompletionsExtraBody({ streaming: stream })
    : undefined;

  return [
    {
      ...firstTrace,
      kind,
      ...(alibabaExtraBody ? { extra_body: alibabaExtraBody } : {}),
    },
    ...requestTrace.slice(1),
  ];
}

function createAiSdkLanguageModel(config: OpenAiTransportConfig): any {
  if (isDeepSeekOfficialAiSdkProvider(config)) {
    return createAiSdkDeepSeekProvider(config).chat(config.model);
  }

  if (isXaiOfficialAiSdkProvider(config)) {
    return createAiSdkXaiProvider(config).chat(config.model);
  }

  if (isAlibabaOfficialAiSdkProvider(config)) {
    return createAiSdkAlibabaProvider(config).chatModel(config.model);
  }

  if (isVercelAiGatewayProvider(config)) {
    return createAiSdkGatewayProvider(config)(config.model);
  }

  if (isOpenAiOfficialAiSdkProvider(config)) {
    return createAiSdkOpenAiProvider(config).chat(config.model);
  }

  if (isGoogleOfficialAiSdkProvider(config)) {
    return createAiSdkGoogleProvider(config).chat(config.model);
  }

  if (isGoogleVertexOfficialAiSdkProvider(config)) {
    return createAiSdkGoogleVertexProvider(config)(config.model);
  }

  if (isMoonshotOfficialAiSdkProvider(config)) {
    return createAiSdkMoonshotProvider(config).chatModel(config.model);
  }

  return createAiSdkOpenAiCompatibleProvider(config).chatModel(config.model);
}

function createAiSdkImageModel(config: OpenAiImageGenerationConfig): any {
  if (isVercelAiGatewayImageConfig(config)) {
    // Gateway 生图走 v3 image-model 协议，不能复用 chat 预设的 /v1 baseUrl。
    return createGateway({ apiKey: config.apiKey, fetch: getLlmFetch() }).image(config.model);
  }

  return createAiSdkOpenAiCompatibleProvider(config, { includeChatVendorExtras: false }).imageModel(config.model);
}

function createAiSdkOpenAiCompatibleProvider(
  config: OpenAiTransportConfig | OpenAiImageGenerationConfig,
  options: { includeChatVendorExtras?: boolean } = {},
) {
  const transportConfig = config as OpenAiTransportConfig;
  const vendorExtras = options.includeChatVendorExtras === false
    ? {}
    : openAiVendorChatCompletionBodyExtras(transportConfig);
  const fetchWrapper =
    Object.keys(vendorExtras).length === 0
      ? undefined
      : async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = tryParseRequestBody(init?.body);
          if (!isJsonObject(body)) {
            return getLlmFetch()(input, init);
          }

          return getLlmFetch()(input, {
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
    fetch: fetchWrapper ?? getLlmFetch(),
  });
}

function createAiSdkMoonshotProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const fetchWrapper = async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = tryParseRequestBody(init?.body);
    if (!isJsonObject(body)) {
      return getLlmFetch()(input, init);
    }

    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : 'request';
    const moonshotMessages = requestUrl.includes('/chat/completions')
      ? takeMoonshotChatCompletionMessages()
      : undefined;
    return getLlmFetch()(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
        ...(moonshotMessages ? { messages: moonshotMessages } : {}),
      }),
    });
  };

  return createMoonshotAI({
    apiKey: config.apiKey,
    baseURL: normalizeMoonshotApiBase(config.baseUrl),
    fetch: fetchWrapper,
  });
}

function createAiSdkXaiProvider(config: OpenAiTransportConfig) {
  return createXai({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_XAI_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAiSdkGoogleProvider(config: OpenAiTransportConfig) {
  return createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_GOOGLE_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAiSdkGoogleVertexProvider(config: OpenAiTransportConfig) {
  const project = config.vertexProject?.trim();
  const location = config.vertexLocation?.trim();
  const apiKey = config.apiKey?.trim();
  const clientEmail = config.vertexClientEmail?.trim();
  const privateKey = config.vertexPrivateKey?.trim();
  const expressOnly = Boolean(apiKey) && !clientEmail && !privateKey && !project && !location;

  if (expressOnly) {
    return createVertex({
      apiKey,
      fetch: getLlmFetch(),
    } as Parameters<typeof createVertex>[0]);
  }

  const googleAuthOptions = clientEmail && privateKey
    ? {
        credentials: {
          client_email: clientEmail,
          private_key: privateKey.replace(/\\n/g, '\n'),
        },
      }
    : config.vertexGoogleAuthOptions;

  return createVertex({
    ...(project ? { project } : {}),
    ...(location ? { location } : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(googleAuthOptions ? { googleAuthOptions } : {}),
    ...(apiKey ? { apiKey } as Record<string, string> : {}),
    fetch: getLlmFetch(),
  } as Parameters<typeof createVertex>[0]);
}

function createAiSdkDeepSeekProvider(config: OpenAiTransportConfig) {
  const reasoningEffort = openAiReasoningEffort(config);
  const fetchWrapper =
    reasoningEffort === undefined
      ? undefined
      : async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = tryParseRequestBody(init?.body);
          if (!isJsonObject(body)) {
            return getLlmFetch()(input, init);
          }

          return getLlmFetch()(input, {
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
    fetch: fetchWrapper ?? getLlmFetch(),
  });
}

function createAiSdkAlibabaProvider(config: OpenAiTransportConfig) {
  const fetchWrapper = shouldUseAlibabaChatCompletionsBuiltInTools(config)
    ? createAlibabaChatCompletionsAwareFetch(config, getLlmFetch())
    : getLlmFetch();

  return createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    fetch: fetchWrapper,
  });
}

function createAiSdkGatewayProvider(config: OpenAiTransportConfig) {
  // Gateway chat 走 v3 AI 协议（默认 …/v3/ai/language-model），不能用模型目录预设的 /v1 baseUrl。
  return createGateway({
    apiKey: config.apiKey,
    fetch: getLlmFetch(),
  });
}

function createAiSdkOpenAiProvider(config: OpenAiTransportConfig) {
  return createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
    fetch: getLlmFetch(),
  });
}

function buildAiSdkProviderOptions(
  config: OpenAiTransportConfig,
): Record<string, JsonObject> {
  if (isAlibabaOfficialAiSdkProvider(config)) {
    const extraBody = shouldUseAlibabaChatCompletionsBuiltInTools(config)
      ? buildAlibabaChatCompletionsExtraBody({ streaming: true })
      : undefined;

    if (extraBody === undefined) {
      return {};
    }

    return {
      alibaba: {
        extraBody,
      } as JsonObject,
    };
  }

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

  if (isMoonshotOfficialAiSdkProvider(config)) {
    const moonshotaiOptions = {
      thinking: {
        type: config.vendorExtendedThinking === false ? 'disabled' : 'enabled',
      },
    } satisfies MoonshotAILanguageModelOptions;

    return {
      moonshotai: moonshotaiOptions as JsonObject,
    };
  }

  if (isXaiOfficialAiSdkProvider(config)) {
    const reasoningEffort = xaiChatReasoningEffort(openAiReasoningEffort(config));
    if (reasoningEffort === undefined) {
      return {};
    }

    const xaiOptions = {
      reasoningEffort,
    } satisfies XaiLanguageModelChatOptions;

    return {
      xai: xaiOptions as JsonObject,
    };
  }

  if (isGoogleOfficialAiSdkProvider(config)) {
    const thinkingConfig = buildGoogleThinkingConfig(config);
    if (thinkingConfig === undefined) {
      return {};
    }

    const googleOptions = {
      thinkingConfig,
    } satisfies GoogleGenerativeAIProviderOptions;

    return {
      google: googleOptions as JsonObject,
    };
  }

  if (isGoogleVertexOfficialAiSdkProvider(config)) {
    const thinkingConfig = buildGoogleThinkingConfig(config);
    if (thinkingConfig === undefined) {
      return {};
    }

    const vertexOptions = {
      thinkingConfig,
    } satisfies GoogleGenerativeAIProviderOptions;

    return {
      vertex: vertexOptions as JsonObject,
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
      case 'video_url':
        // Moonshot AI 视频：AI SDK 会丢弃 video_url，由 fetch 包装器写回完整 messages（见 moonshot-chat-completion-messages.ts）。
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
  usageSource: Parameters<typeof readAiSdkUsage>[0],
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
    const usage = await readAiSdkUsage(usageSource);
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
      const previousFunctionName = existing?.functionName ?? '';
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
        shouldEmitStreamingToolNamePreview(current.functionName, previousFunctionName)
        && !isGeneratedStreamingToolCallId(current.id)
      ) {
        updates.push({
          kind: 'streaming-tool-preview',
          toolCallId: current.id,
          toolName: current.functionName,
          argumentsJson: current.functionArguments,
        });
      }

      if (current.functionName === 'finish_task') {
        if (finishTaskStreamingPreviewReady(current.functionName, current.functionArguments)) {
          updates.push({
            kind: 'streaming-tool-preview',
            toolCallId: current.id,
            toolName: current.functionName,
            argumentsJson: current.functionArguments,
          });
        }
      } else if (
        current.functionName &&
        !isGeneratedStreamingToolCallId(current.id)
      ) {
        const previewState = {
          readyPreviewEmitted: current.readyPreviewEmitted,
          ...(current.lastPreviewArgsLen === undefined
            ? {}
            : { lastPreviewArgsLen: current.lastPreviewArgsLen }),
          ...(current.lastPreviewDetailSignature === undefined
            ? {}
            : { lastPreviewDetailSignature: current.lastPreviewDetailSignature }),
        };
        const decision = resolveStreamingToolPreviewEmit(
          current.functionName,
          current.functionArguments,
          previewState,
        );
        if (decision.emit) {
          updates.push({
            kind: 'streaming-tool-preview',
            toolCallId: current.id,
            toolName: current.functionName,
            argumentsJson: current.functionArguments,
          });
          current.readyPreviewEmitted = decision.nextState.readyPreviewEmitted;
          if (decision.nextState.lastPreviewArgsLen !== undefined) {
            current.lastPreviewArgsLen = decision.nextState.lastPreviewArgsLen;
          }
          if (decision.nextState.lastPreviewDetailSignature !== undefined) {
            current.lastPreviewDetailSignature = decision.nextState.lastPreviewDetailSignature;
          }
        }
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

function openAiTransportAssetRoot(config: Pick<OpenAiTransportConfig, 'workspaceRoot'>): string {
  return config.workspaceRoot ?? process.cwd();
}

function prepareMoonshotChatCompletionRequest(
  config: OpenAiTransportConfig,
  requestMessages: JsonValue[],
): void {
  if (config.llmVendor === 'moonshot-ai' && openAiMessagesContainVideoUrl(requestMessages)) {
    stashMoonshotChatCompletionMessages(requestMessages);
  }
}

function clearMoonshotChatCompletionRequest(config: OpenAiTransportConfig): void {
  if (config.llmVendor === 'moonshot-ai') {
    clearMoonshotChatCompletionMessages();
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

  let content = cloned.content;
  if (profile.hasExplicitCapabilities && !profile.capabilities.imageInput) {
    content = content.filter(
      (part) => !(isJsonObject(part) && part.type === 'image_url'),
    );
  }
  if (profile.hasExplicitCapabilities && !profile.capabilities.videoInput) {
    content = content.filter(
      (part) => !(isJsonObject(part) && part.type === 'video_url'),
    );
  }

  if (content !== cloned.content) {
    const textParts = content.filter(
      (part) => isJsonObject(part) && part.type === 'text' && typeof part.text === 'string',
    );
    return {
      ...cloned,
      content: textParts.length > 0 ? textParts : '',
    };
  }

  return cloned;
}

function isDeepSeekOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'deepseek';
}

function isXaiOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'xai';
}

function isMoonshotOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'moonshot-ai';
}

function usesStructuredReasoningStreamEvents(config: OpenAiTransportConfig): boolean {
  return isDeepSeekOfficialAiSdkProvider(config) || isMoonshotOfficialAiSdkProvider(config);
}

function isAlibabaOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'alibaba';
}

function isVercelAiGatewayProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'vercel-ai-gateway';
}

function isVercelAiGatewayImageConfig(
  config: OpenAiImageGenerationConfig,
): boolean {
  return config.llmVendor === 'vercel-ai-gateway';
}

function isOpenAiOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'openai';
}

function isGoogleOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'google';
}

function isGoogleVertexOfficialAiSdkProvider(config: OpenAiTransportConfig): boolean {
  return config.llmVendor === 'google-vertex-ai';
}

function isGoogleGemini3Model(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes('gemini-3');
}

function buildGoogleThinkingConfig(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): GoogleGenerativeAIProviderOptions['thinkingConfig'] | undefined {
  const effort = openAiReasoningEffort(config);
  if (effort === undefined) {
    return undefined;
  }

  if (effort === 'none') {
    if (isGoogleGemini3Model(config.model)) {
      return { thinkingLevel: 'minimal' };
    }

    return { thinkingBudget: 0 };
  }

  if (isGoogleGemini3Model(config.model)) {
    if (effort === 'low' || effort === 'medium' || effort === 'high') {
      return {
        thinkingLevel: effort,
        includeThoughts: true,
      };
    }

    return undefined;
  }

  const thinkingBudget = googleGemini25ThinkingBudgetForEffort(effort);
  if (thinkingBudget === undefined) {
    return undefined;
  }

  return {
    thinkingBudget,
    includeThoughts: thinkingBudget > 0,
  };
}

function googleGemini25ThinkingBudgetForEffort(
  effort: string,
): number | undefined {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 8192;
    default:
      return undefined;
  }
}

function xaiChatReasoningEffort(
  effort: string | undefined,
): XaiLanguageModelChatOptions['reasoningEffort'] | undefined {
  if (effort === 'low' || effort === 'high') {
    return effort;
  }

  return effort === 'medium' ? 'high' : undefined;
}

function buildAiSdkImageGenerationUrl(config: OpenAiImageGenerationConfig): string {
  if (isVercelAiGatewayImageConfig(config)) {
    return 'https://ai-gateway.vercel.sh/v3/ai/image-model';
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_OPENAI_COMPATIBLE_BASE_URL).replace(/\/$/, '');
  return `${baseUrl}/images/generations`;
}

function logAiSdkImageGenerationStart(
  config: OpenAiImageGenerationConfig,
  request: ImageGenerationRequest,
  requestUrl: string,
): void {
  console.error('[agent-core][generate-image] request.start', {
    adapter: isVercelAiGatewayImageConfig(config) ? 'ai-sdk-gateway-image' : 'openai-compatible-image',
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

function isGeneratedStreamingToolCallId(value: string): boolean {
  return value.startsWith(STREAMING_TOOL_CALL_PLACEHOLDER_PREFIX);
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
