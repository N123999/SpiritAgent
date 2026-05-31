import { generateText } from 'ai';

import type {
  JsonValue,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
} from '../ports.js';
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
import { buildResponsesProviderOptions, createResponsesLanguageModel } from './model-factory.js';
import {
  attachResponseIdToAssistantMessage,
  extractResponseIdFromGenerateTextResult,
  findPreviousResponseId,
} from './provider-state.js';
import {
  buildOpenResponsesRequestTrace,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

export class AiSdkOpenResponsesTransport
  implements LlmTransport<OpenResponsesTransportConfig, ToolAgentState>
{
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
    const traceExtras: Parameters<typeof buildOpenResponsesRequestTrace>[5] = {
      ...(config.store !== undefined ? { store: config.store } : {}),
      ...(previousResponseId ? { previousResponseId } : {}),
      ...(config.truncation ? { truncation: config.truncation } : {}),
    };
    const tracedRequest = buildOpenResponsesRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      false,
      traceExtras,
    );

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
    void config;
    void state;
    void tools;
    throw new Error('Open Responses transport: startToolAgentRoundStreaming 尚未实现。');
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
    void config;
    void onProgress;
    const beforeLength = history.length;
    if (beforeLength === 0) {
      return {
        droppedMessages: 0,
        beforeLength,
        afterLength: 0,
      };
    }

    throw new Error('Open Responses transport: compactHistoryManual 尚未实现。');
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
