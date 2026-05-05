import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

import {
  buildOpenAiRequestTrace as buildRequestTrace,
  openAiReasoningEffort,
  openAiVendorChatCompletionBodyExtras,
  type OpenAiLlmVendor,
  type OpenAiRequestTrace,
  type OpenAiTransportConfig,
} from './openai-compat.js';
import {
  isOpenAiVisionUnsupportedError,
  llmHistoryToOpenAiMessages,
  type OpenAiToolAgentState,
} from './tool-agent-helpers.js';

import type {
  JsonObject,
  JsonValue,
  LlmStreamEvent,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from '../ports.js';
import {
  COMPACT_SUMMARY_PREFIX,
  buildToolAgentHostPrompt,
  cloneJsonValue,
  isJsonObject,
} from '../tool-agent.js';
import {
  buildJsonSchemaCompletionMessages,
  buildStructuredOutputResponseFormat,
  extractJsonSchemaCompletionContent,
  parseJsonSchemaCompletionOutput,
  type OpenAiJsonSchemaCompletionRequest,
  type OpenAiJsonSchemaCompletionResult,
  type OpenAiJsonSchemaTransport,
} from './json-schema.js';

export {
  appendOpenAiToolResultMessage,
  appendOpenAiToolResultMessages,
  appendOpenAiUserMessage,
  buildActiveSkillsSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
  continueOpenAiToolAgentState,
  extractLastOpenAiAssistantText,
  isOpenAiVisionUnsupportedError,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
} from './tool-agent-helpers.js';
export type { OpenAiLlmVendor, OpenAiRequestTrace, OpenAiTransportConfig } from './openai-compat.js';
export type {
  OpenAiActiveSkill,
  OpenAiActiveSkillResourceEntry,
  OpenAiEnabledRule,
  OpenAiEnabledSkillCatalogEntry,
  OpenAiExtensionSystemPrompt,
  OpenAiPlanMetadata,
  OpenAiToolAgentState,
  OpenAiToolResult,
} from './tool-agent-helpers.js';

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  type: 'function';
  functionName: string;
  functionArguments: string;
  /** True once we emitted a "准备调用工具" line (args JSON is complete enough for host.parse). */
  readyPreviewEmitted: boolean;
}

export class OpenAiTransport
  implements LlmTransport<OpenAiTransportConfig, OpenAiToolAgentState>, OpenAiJsonSchemaTransport
{
  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const client = createOpenAiClient(config);
    const messages = normalizeMessagesForRequest(
      buildJsonSchemaCompletionMessages(config, request),
    );
    const requestTrace = buildRequestTrace(config, 1, messages, []);
    const reasoningEffort = openAiReasoningEffort(config);
    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages as unknown as ChatCompletionMessageParam[],
      response_format: buildStructuredOutputResponseFormat(config, request),
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      ...vendorExtras,
    } as ChatCompletionCreateParamsNonStreaming);
    const content = extractJsonSchemaCompletionContent(response);

    return {
      output: parseJsonSchemaCompletionOutput<T>(content),
      rawText: content,
      requestTrace,
    };
  }

  async startToolAgentRound(
    config: OpenAiTransportConfig,
    state: OpenAiToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<OpenAiToolAgentState>> {
    const client = createOpenAiClient(config);
    const nextState: OpenAiToolAgentState = {
      messages: [...state.messages],
      steps: state.steps + 1,
    };

    const normalizedTools = normalizeTools(tools);
    const requestMessages = normalizeMessagesForRequest(nextState.messages);
    const requestTrace = buildRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    const reasoningEffort = openAiReasoningEffort(config);
    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const payload = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
      ...vendorExtras,
    } as ChatCompletionCreateParamsNonStreaming;

    try {
      const response = await client.chat.completions.create(payload);
      const choice = response.choices.at(0);
      const message = choice?.message;
      if (!message) {
        return {
          kind: 'failure',
          error: 'OpenAI SDK 返回了空 choices[0].message。',
          requestTrace,
        };
      }

      const assistantMessage = normalizeAssistantMessage(
        message,
        shouldInjectSyntheticToolReasoning(),
      );
      nextState.messages.push(assistantMessage);

      const calls = extractToolCalls(message.tool_calls);
      if (calls.length > 0) {
        return {
          kind: 'success',
          result: {
            state: nextState,
            step: {
              kind: 'tool-calls',
              calls,
            },
            requestTrace,
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
          requestTrace,
        },
      };
    } catch (error) {
      return {
        kind: 'failure',
        error: renderOpenAiError(error),
        requestTrace,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenAiTransportConfig,
    state: OpenAiToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<OpenAiToolAgentState>> {
    const client = createOpenAiClient(config);
    const nextState: OpenAiToolAgentState = {
      messages: [...state.messages],
      steps: state.steps + 1,
    };

    const normalizedTools = normalizeTools(tools);
    const requestMessages = normalizeMessagesForRequest(nextState.messages);
    const requestTrace = buildRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );
    const reasoningEffort = openAiReasoningEffort(config);
    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const payload = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      stream: true,
      ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
      ...vendorExtras,
    } as ChatCompletionCreateParamsStreaming;

    const abortController = new AbortController();
    try {
      const stream = await client.chat.completions.create(payload, {
        signal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<OpenAiToolAgentState>>();

      return {
        eventStream: openAiEventStreamToRuntimeEvents(
          stream,
          nextState,
          requestTrace,
          completion,
          shouldInjectSyntheticToolReasoning(),
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyOpenAiEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: renderOpenAiError(error),
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

    const client = createOpenAiClient(config);
    const compactionMessages: ChatCompletionMessageParam[] = [
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
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join('\n\n'),
      },
    ];

    const reasoningEffort = openAiReasoningEffort(config);
    const compactionVendorExtras = openAiVendorChatCompletionBodyExtras(config);
    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const stream = await client.chat.completions.create({
          model: config.compactModel ?? config.model,
          stream: true,
          messages: compactionMessages,
          ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
          ...compactionVendorExtras,
        } as ChatCompletionCreateParamsStreaming);

        for await (const chunk of stream) {
          for (const choice of chunk.choices) {
            for (const rawText of [choice.delta.content, choice.delta.refusal]) {
              if (typeof rawText !== 'string' || rawText.length === 0) {
                continue;
              }

              const normalizedText = trimLeadingStreamLineBreaks(summary, rawText);
              if (!normalizedText) {
                continue;
              }

              summary += normalizedText;
              emittedProgress = true;
              onProgress(normalizedText);
            }
          }
        }
      } catch (error) {
        if (emittedProgress) {
          throw error;
        }
      }
    }

    if (!summary.trim()) {
      const response = await client.chat.completions.create({
        model: config.compactModel ?? config.model,
        messages: compactionMessages,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
        ...compactionVendorExtras,
      } as ChatCompletionCreateParamsNonStreaming);
      summary = response.choices.at(0)?.message?.content ?? '';
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error('OpenAI SDK 压缩返回为空，无法生成摘要。');
    }

    history.splice(0, history.length, {
      role: 'system',
      content: `${COMPACT_SUMMARY_PREFIX}\n${normalizedSummary}`,
      imagePaths: [],
    });

    return {
      droppedMessages: saturatingSub(beforeLength, 1),
      beforeLength,
      afterLength: history.length,
    };
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return history
      .find((message) => message.role === 'system' && message.content.startsWith(COMPACT_SUMMARY_PREFIX))
      ?.content.slice(COMPACT_SUMMARY_PREFIX.length)
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

  isVisionUnsupportedError(error: string): boolean {
    return isOpenAiVisionUnsupportedError(error);
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

function createOpenAiClient(config: OpenAiTransportConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
  });
}

async function* openAiEventStreamToRuntimeEvents(
  stream: AsyncIterable<ChatCompletionChunk>,
  nextState: OpenAiToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<OpenAiToolAgentState>>,
  injectEmptyToolReasoningContent = true,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<number, AggregatedStreamingToolCall>();
  let assistantContent = '';
  let reasoningContent = '';
  let sawAnswerOrToolOutput = false;
  const rawPreview: string[] = [];

  try {
    for await (const chunk of stream) {
      if (rawPreview.length < 8) {
        rawPreview.push(truncateChars(JSON.stringify(chunk), 320));
      }

      for (const choice of chunk.choices) {
        const delta = choice.delta;
        const thinkingText = extractStreamingThinkingText(delta);
        if (thinkingText) {
          reasoningContent += thinkingText;
          yield { kind: 'thinking-chunk', text: thinkingText };
        }

        if ((delta.tool_calls?.length ?? 0) > 0) {
          sawAnswerOrToolOutput = true;
        }

        for (const streamEvent of accumulateStreamingToolCallProgress(toolCalls, delta.tool_calls)) {
          yield streamEvent;
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          sawAnswerOrToolOutput = true;
          assistantContent += delta.content;
          yield { kind: 'assistant-chunk', text: delta.content };
        }

        if (typeof delta.refusal === 'string' && delta.refusal.length > 0) {
          sawAnswerOrToolOutput = true;
          assistantContent += delta.refusal;
          yield { kind: 'assistant-chunk', text: delta.refusal };
        }
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      const preview = rawPreview.length === 0 ? '<empty stream body>' : rawPreview.join('\n');
      throw new Error(`流式响应无任何 delta（无 content / tool_calls）。预览:\n${truncateChars(preview, 600)}`);
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(
        assistantContent,
        reasoningContent,
        toolCalls,
        injectEmptyToolReasoningContent,
      ),
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
    const rendered = renderOpenAiError(error);
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

function normalizeTools(tools: JsonValue): ChatCompletionTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isJsonObject)
    .filter((tool) => tool.type === 'function' && isJsonObject(tool.function))
    .map((tool) => tool as unknown as ChatCompletionTool);
}

function normalizeAssistantMessage(
  message: ChatCompletionMessage,
  injectEmptyToolReasoningContent = true,
): JsonValue {
  const functionToolCalls = extractFunctionToolCalls(message.tool_calls);
  const reasoningContent = extractAssistantReasoningContent(message);

  return withReasoningContentIfNeeded({
    role: 'assistant',
    content: message.content ?? null,
    ...(functionToolCalls.length > 0
      ? {
          tool_calls: functionToolCalls.map((call) => ({
            id: call.id,
            type: call.type,
            function: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          })),
        }
      : {}),
  }, reasoningContent, injectEmptyToolReasoningContent);
}

function extractToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | null | undefined,
): ToolCallRequest[] {
  return extractFunctionToolCalls(toolCalls).map((call) => ({
    id: call.id,
    name: call.function.name,
    argumentsJson: call.function.arguments,
  }));
}

function extractFunctionToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | null | undefined,
): Extract<ChatCompletionMessageToolCall, { type: 'function' }>[] {
  return (toolCalls ?? []).filter(
    (call): call is Extract<ChatCompletionMessageToolCall, { type: 'function' }> =>
      call.type === 'function',
  );
}

function extractAssistantReasoningContent(message: ChatCompletionMessage): string {
  const raw = message as unknown as Record<string, unknown>;
  const pieces = [
    raw.reasoning_content,
    raw.reasoningContent,
    raw.reasoning,
    raw.thinking,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return pieces.join('');
}

function extractStreamingThinkingText(delta: ChatCompletionChunk.Choice.Delta): string | undefined {
  const raw = delta as unknown as Record<string, unknown>;
  const chunks = [
    raw.reasoning,
    raw.reasoning_content,
    raw.reasoningText,
    raw.reasoning_text,
    raw.thinking,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');

  return chunks || undefined;
}

function accumulateStreamingToolCallProgress(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  deltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
): LlmStreamEvent[] {
  if (!deltas || deltas.length === 0) {
    return [];
  }

  const updates: LlmStreamEvent[] = [];
  for (const delta of deltas) {
    const existing = toolCalls.get(delta.index);
    const current: AggregatedStreamingToolCall = existing ?? {
      index: delta.index,
      id: delta.id ?? `stream-tool-call-${delta.index}`,
      type: 'function',
      functionName: '',
      functionArguments: '',
      readyPreviewEmitted: false,
    };

    if (delta.id) {
      current.id = delta.id;
    }
    if (delta.function?.name) {
      current.functionName += delta.function.name;
    }
    if (delta.function?.arguments) {
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

  return updates;
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  injectEmptyToolReasoningContent = true,
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

  return withReasoningContentIfNeeded({
    role: 'assistant',
    content: assistantContent || null,
    ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
  }, reasoningContent, injectEmptyToolReasoningContent);
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

function withReasoningContentIfNeeded(
  message: JsonObject,
  reasoningContent: string,
  injectEmptyToolReasoningContent = true,
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

  if (toolCalls.length > 0 && injectEmptyToolReasoningContent) {
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

function buildToolProgressPreview(name: string, argumentsJson: string): string {
  const lineHint = tryCountContentLines(argumentsJson);
  if (lineHint !== undefined && lineHint > 0) {
    return `准备调用工具: ${name}（约 ${lineHint} 行内容）`;
  }

  return `准备调用工具: ${name}`;
}

/**
 * Matches host `request_from_function_call` / `required_string_arg` closely enough that we only
 * show "准备调用工具" once the streamed arguments can actually be parsed and approved — avoids
 * implying a full tool call when the model will hit `[tool schema error]` before `authorize`.
 */
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
    const v = parsed[key];
    return typeof v === 'string' && v.trim().length > 0;
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
    case 'search_files':
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
      // Smoke demos, MCP tools, or future host tools: accept any object whose JSON is complete and
      // has at least one non-empty string field (streaming partial JSON still fails parse).
      return Object.values(parsed).some(
        (v) => typeof v === 'string' && (v as string).trim().length > 0,
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

function renderOpenAiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  return `${chars.slice(0, maxChars).join('')}...`;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
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

function normalizeMessagesForRequest(messages: JsonValue[]): JsonValue[] {
  return messages.map((message) => cloneJsonValue(message));
}

function shouldInjectSyntheticToolReasoning(): boolean {
  return true;
}

async function* emptyOpenAiEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}
