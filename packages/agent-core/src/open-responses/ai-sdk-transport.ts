import { generateObject, generateText, jsonSchema, streamText } from 'ai';

import type {
  JsonValue,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
} from '../ports.js';
import type { JsonSchemaCompletionRequest, JsonSchemaCompletionResult, JsonSchemaTransport } from '../json-schema.js';
import {
  buildJsonSchemaCompletionMessages,
  stringifyJsonSchemaCompletionOutput,
} from '../openai/json-schema.js';
import { llmMessageHasImages, llmMessageHasVideos, llmMessageTextContent } from '../ports.js';
import {
  COMPACT_SUMMARY_PREFIX,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
  type ToolAgentState,
} from '../tool-agent.js';
import { llmHistoryToOpenAiMessages } from '../openai/tool-agent-helpers.js';
import {
  buildAssistantMessageFromResponsesGenerateText,
  buildResponsesAiSdkTools,
  extractToolCallsFromAiSdk,
  normalizeResponsesToolDefinitions,
  openAiMessagesToResponsesAiSdkMessages,
  renderResponsesTransportError,
} from './ai-sdk-message-bridge.js';
import {
  buildResponsesTraceTools,
  mergeToolCallsWithApplyPatch,
  registerPendingApplyPatchCallIds,
  takeLastExtractedApplyPatchCalls,
} from './apply-patch-bridge.js';
import { buildResponsesProviderOptions, createResponsesLanguageModel } from './model-factory.js';
import {
  attachResponseIdToAssistantMessage,
  extractResponseIdFromGenerateTextResult,
  findPreviousResponseId,
} from './provider-state.js';
import {
  buildOpenResponsesRequestTrace,
  buildOpenResponsesTraceExtras,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';
import { createDeferred, responsesEventStreamToRuntimeEvents } from './streaming.js';

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}

function trimLeadingStreamLineBreaks(existingText: string, nextText: string): string {
  if (existingText.length > 0) {
    return nextText;
  }

  return nextText.replace(/^[\r\n]+/u, '');
}

export class AiSdkOpenResponsesTransport
  implements
    LlmTransport<OpenResponsesTransportConfig, ToolAgentState>,
    JsonSchemaTransport
{
  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenResponsesTransportConfig,
    request: JsonSchemaCompletionRequest,
  ): Promise<JsonSchemaCompletionResult<T>> {
    const messages = buildJsonSchemaCompletionMessages(
      {
        model: config.model,
        ...(config.llmVendor ? { llmVendor: config.llmVendor } : {}),
      },
      request,
    );
    const requestTrace = buildOpenResponsesRequestTrace(config, 1, messages, []);

    try {
      const result = await generateObject({
        model: createResponsesLanguageModel(config) as any,
        messages: openAiMessagesToResponsesAiSdkMessages(messages) as any,
        allowSystemInMessages: true,
        schema: jsonSchema(request.schema as Record<string, unknown>),
        schemaName: request.schemaName,
        providerOptions: buildResponsesProviderOptions(config),
        maxRetries: 0,
      });
      const output = cloneJsonValue(result.object as JsonValue) as T;

      return {
        output,
        rawText: stringifyJsonSchemaCompletionOutput(output),
        requestTrace,
      };
    } catch (error) {
      throw new Error(renderResponsesTransportError(error));
    }
  }

  async startToolAgentRound(
    config: OpenResponsesTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeResponsesToolDefinitions(tools);
    const previousResponseId = findPreviousResponseId(requestMessages);
    const traceExtras = buildOpenResponsesTraceExtras(config, previousResponseId);
    const tracedRequest = buildOpenResponsesRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      buildResponsesTraceTools(config, normalizedTools),
      false,
      traceExtras,
    );

    if (xaiResponsesHasLocalTools(config, normalizedTools)) {
      return {
        kind: 'failure',
        error: xaiResponsesLocalToolsUnsupportedMessage(),
        requestTrace: tracedRequest,
      };
    }

    try {
      const result = await generateText({
        model: createResponsesLanguageModel(config) as any,
        messages: openAiMessagesToResponsesAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildResponsesAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildResponsesProviderOptions(config, previousResponseId),
        maxRetries: 0,
      });

      const assistantMessage = attachResponseIdToAssistantMessage(
        config,
        buildAssistantMessageFromResponsesGenerateText(
          result.text,
          result.toolCalls,
          result.reasoningText ?? '',
        ),
        extractResponseIdFromGenerateTextResult(result),
      );
      nextState.messages.push(assistantMessage);

      const applyPatchCalls = takeLastExtractedApplyPatchCalls();
      if (applyPatchCalls.length > 0) {
        registerPendingApplyPatchCallIds(applyPatchCalls.map((call) => call.id));
      }
      const calls = mergeToolCallsWithApplyPatch(
        extractToolCallsFromAiSdk(result.toolCalls),
        applyPatchCalls,
      );
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
        error: renderResponsesTransportError(error),
        requestTrace: tracedRequest,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenResponsesTransportConfig,
    state: ToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<ToolAgentState>> {
    const nextState: ToolAgentState = {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps + 1,
    };

    const requestMessages = nextState.messages.map((message) => cloneJsonValue(message));
    const normalizedTools = normalizeResponsesToolDefinitions(tools);
    const previousResponseId = findPreviousResponseId(requestMessages);
    const traceExtras = buildOpenResponsesTraceExtras(config, previousResponseId);
    const requestTrace = buildOpenResponsesRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      buildResponsesTraceTools(config, normalizedTools),
      true,
      traceExtras,
    );

    const abortController = new AbortController();

    if (xaiResponsesHasLocalTools(config, normalizedTools)) {
      return {
        eventStream: emptyResponsesEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: xaiResponsesLocalToolsUnsupportedMessage(),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }

    try {
      const result: { fullStream: AsyncIterable<unknown> } = streamText({
        model: createResponsesLanguageModel(config) as any,
        messages: openAiMessagesToResponsesAiSdkMessages(requestMessages) as any,
        allowSystemInMessages: true,
        ...(normalizedTools.length === 0
          ? {}
          : {
              tools: buildResponsesAiSdkTools(normalizedTools) as any,
              toolChoice: 'auto' as const,
            }),
        providerOptions: buildResponsesProviderOptions(config, previousResponseId),
        includeRawChunks: true,
        maxRetries: 0,
        abortSignal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

      return {
        eventStream: responsesEventStreamToRuntimeEvents(
          config,
          result.fullStream as any,
          nextState,
          requestTrace,
          completion,
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyResponsesEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: renderResponsesTransportError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: OpenResponsesTransportConfig,
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

    const promptMessages = openAiMessagesToResponsesAiSdkMessages([
      {
        role: 'system',
        content: [
          'Summarize the following conversation into a reusable system summary for later turns.',
          'Preserve: user goals, key constraints, verified conclusions, failed attempts, and open items.',
          'Omit small talk.',
          'Output plain text only.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: history
          .map((message) => {
            const text = llmMessageTextContent(message.content);
            const mediaNote = llmMessageHasImages(message.content)
              ? '\n[images attached]'
              : llmMessageHasVideos(message.content)
                ? '\n[videos attached]'
                : '';
            return `${message.role.toUpperCase()}: ${text}${mediaNote}`;
          })
          .join('\n\n'),
      },
    ]);
    const compactConfig: OpenResponsesTransportConfig = {
      ...config,
      model: config.compactModel ?? config.model,
    };

    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const streamed = streamText({
          model: createResponsesLanguageModel(compactConfig) as any,
          messages: promptMessages as any,
          allowSystemInMessages: true,
          providerOptions: buildResponsesProviderOptions(compactConfig),
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
        model: createResponsesLanguageModel(compactConfig) as any,
        messages: promptMessages as any,
        allowSystemInMessages: true,
        providerOptions: buildResponsesProviderOptions(compactConfig),
        maxRetries: 0,
      });
      summary = result.text;
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error('Open Responses 压缩返回为空，无法生成摘要。');
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
          message.role === 'system' &&
          message.content.some(
            (part) => part.type === 'text' && part.text.startsWith(COMPACT_SUMMARY_PREFIX),
          ),
      )
      ?.content.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
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

async function* emptyResponsesEventStream(): AsyncGenerator<
  import('../ports.js').LlmStreamEvent,
  void,
  undefined
> {}

function xaiResponsesHasLocalTools(
  config: OpenResponsesTransportConfig,
  normalizedTools: readonly unknown[],
): boolean {
  return config.llmVendor === 'xai' && normalizedTools.length > 0;
}

function xaiResponsesLocalToolsUnsupportedMessage(): string {
  return 'xAI Responses API 暂不支持本地 function tools，请改用 Chat Completions transport。';
}
