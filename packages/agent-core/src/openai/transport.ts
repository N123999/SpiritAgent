import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

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

const TOOL_AGENT_SYSTEM_PROMPT = [
  'You are Spirit Agent.',
  '',
  'When composing replies, follow conventional typography and editorial norms for each language you use (spacing, punctuation, and mixed-script text such as Latin alongside CJK or other scripts).',
  '',
  'Available tools are defined only by the tools field in this request.',
  'Only call declared functions.',
  'When the user clearly asks to inspect files, code, or environment, you may use tools.',
  'Do not invent tools or capabilities that are not present in the request.',
].join('\n');

const COMPACT_SUMMARY_PREFIX = '[SPIRIT_COMPACT_SUMMARY]';
const TOOL_MEMORY_PREFIX = '[TOOL_MEMORY]';
const TOOL_OUTPUT_RETRY_MAX_CHARS = 12_000;
const TOOL_MEMORY_RETRY_MAX_CHARS = 4_000;
const TOOL_TRUNCATION_HEAD_RATIO_NUM = 2;
const TOOL_TRUNCATION_HEAD_RATIO_DEN = 3;
const RULES_SECTION_PREFIX = '[SPIRIT_RULES]';

export interface OpenAiTransportConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  temperature?: number;
  compactModel?: string;
  workspaceRoot?: string;
}

export interface OpenAiEnabledRule {
  id: string;
  scope: 'workspace' | 'user';
  title: string;
  path: string;
  content: string;
}

export interface OpenAiToolAgentState {
  messages: JsonValue[];
  steps: number;
}

export interface OpenAiToolResult {
  toolCallId: string;
  content: string;
}

export interface OpenAiRequestTrace extends JsonObject {
  kind: 'openai_sdk_chat_completions';
  stepIndex: number;
  model: string;
  stream: boolean;
  toolChoice?: 'auto';
  temperature: number;
  messages: JsonValue[];
  tools?: JsonValue[];
}

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  type: 'function';
  functionName: string;
  functionArguments: string;
  nameEmitted: boolean;
}

export function startOpenAiToolAgentState(
  history: LlmMessage[],
  userInput: string,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
): OpenAiToolAgentState {
  const rulesSystemMessage = buildRulesSystemMessage(enabledRules);
  const messages: JsonValue[] = [
    {
      role: 'system',
      content: buildPrimarySystemMessage(rulesSystemMessage),
    },
    ...llmHistoryToOpenAiMessages(history, assetRoot),
  ];

  const lastRole = messages.at(-1);
  const needAppendUser = !isJsonObject(lastRole) || lastRole.role !== 'user';
  if (needAppendUser) {
    messages.push({ role: 'user', content: userInput });
  }

  return {
    messages,
    steps: 0,
  };
}

export function appendOpenAiToolResultMessages(
  state: OpenAiToolAgentState,
  results: OpenAiToolResult[],
): OpenAiToolAgentState {
  if (results.length === 0) {
    return {
      messages: [...state.messages],
      steps: state.steps,
    };
  }

  return {
    messages: [
      ...state.messages,
      ...results.map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.content,
      })),
    ],
    steps: state.steps,
  };
}

export function appendOpenAiToolResultMessage(
  state: OpenAiToolAgentState,
  toolCallId: string,
  content: string,
): OpenAiToolAgentState {
  return appendOpenAiToolResultMessages(state, [{ toolCallId, content }]);
}

export function appendOpenAiUserMessage(
  state: OpenAiToolAgentState,
  content: string,
): OpenAiToolAgentState {
  return {
    messages: [...state.messages, { role: 'user', content }],
    steps: state.steps,
  };
}

export function extractLastOpenAiAssistantText(
  state: OpenAiToolAgentState,
): string | undefined {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }
  }

  return undefined;
}

export function truncateOpenAiToolAgentStateForContextRetry(
  state: OpenAiToolAgentState,
): { state: OpenAiToolAgentState; changed: boolean } {
  let changed = false;
  const messages = state.messages.map((message) => {
    if (!isJsonObject(message) || typeof message.content !== 'string') {
      return cloneJsonValue(message);
    }

    const replacement = truncateMessageContentForRetry(message.role, message.content);
    if (replacement === undefined) {
      return { ...message };
    }

    changed = true;
    return {
      ...message,
      content: replacement,
    };
  });

  return {
    state: {
      messages,
      steps: state.steps,
    },
    changed,
  };
}

export function truncateOpenAiHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  let changed = false;
  const nextHistory = history.map((message) => {
    if (message.role !== 'system' || !message.content.startsWith(TOOL_MEMORY_PREFIX)) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    const replacement = buildContextRetryExcerpt(
      message.content,
      TOOL_MEMORY_RETRY_MAX_CHARS,
      '[tool memory truncated for context retry]',
    );
    if (replacement === undefined) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    changed = true;
    return {
      role: message.role,
      content: replacement,
      imagePaths: [...(message.imagePaths ?? [])],
    };
  });

  return {
    history: nextHistory,
    changed,
  };
}

export function rebuildOpenAiToolAgentStateAfterCompaction(
  history: LlmMessage[],
  userInput: string,
  retryState: OpenAiToolAgentState,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
): OpenAiToolAgentState {
  const preservedRulesSystemMessage = findRulesSystemMessageContent(retryState.messages);
  const rebuilt = startOpenAiToolAgentState(
    history,
    userInput,
    assetRoot,
    preservedRulesSystemMessage === undefined ? enabledRules : [],
  );
  if (preservedRulesSystemMessage !== undefined) {
    rebuilt.messages[0] = {
      role: 'system',
      content: buildPrimarySystemMessage(preservedRulesSystemMessage),
    };
  }
  rebuilt.steps = retryState.steps;

  const userIndex = findLastMatchingIndex(
    retryState.messages,
    (message) =>
      isJsonObject(message) &&
      message.role === 'user' &&
      message.content === userInput,
  );

  if (userIndex < 0) {
    return {
      messages: retryState.messages.map((message) => cloneJsonValue(message)),
      steps: retryState.steps,
    };
  }

  rebuilt.messages.push(
    ...retryState.messages.slice(userIndex + 1).map((message) => cloneJsonValue(message)),
  );
  return rebuilt;
}

export class OpenAiTransport
  implements LlmTransport<OpenAiTransportConfig, OpenAiToolAgentState>
{
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

    const payload: ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      temperature: config.temperature ?? 0.2,
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
    };

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
        shouldInjectSyntheticToolReasoning(config),
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
    const payload: ChatCompletionCreateParamsStreaming = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      temperature: config.temperature ?? 0.2,
      stream: true,
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
    };

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
          shouldInjectSyntheticToolReasoning(config),
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

    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const stream = await client.chat.completions.create({
          model: config.compactModel ?? config.model,
          temperature: 0.2,
          stream: true,
          messages: compactionMessages,
        });

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
        temperature: 0.2,
        messages: compactionMessages,
      });
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
      tool_agent: TOOL_AGENT_SYSTEM_PROMPT,
    };
  }
}

export function buildRulesSystemMessage(
  enabledRules: OpenAiEnabledRule[],
): string | undefined {
  if (enabledRules.length === 0) {
    return undefined;
  }

  const lines = [
    RULES_SECTION_PREFIX,
    'Apply the following enabled rules as additive constraints from their source files.',
    'These rules do not replace the main system prompt; they extend it.',
    '',
  ];

  for (const rule of enabledRules) {
    lines.push(
      `<rule id="${escapeRuleAttribute(rule.id)}" scope="${escapeRuleAttribute(rule.scope)}" title="${escapeRuleAttribute(rule.title)}" path="${escapeRuleAttribute(rule.path)}">`,
    );
    lines.push(rule.content.trimEnd());
    lines.push('</rule>');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function findRulesSystemMessageContent(messages: JsonValue[]): string | undefined {
  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== 'system') {
      continue;
    }
    if (typeof message.content === 'string') {
      const rulesStart = message.content.indexOf(RULES_SECTION_PREFIX);
      if (rulesStart >= 0) {
        return message.content.slice(rulesStart).trim();
      }
    }
  }

  return undefined;
}

function createOpenAiClient(config: OpenAiTransportConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
  });
}

function buildRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: JsonValue[],
  tools: ChatCompletionTool[],
  stream = false,
): JsonValue[] {
  const trace: OpenAiRequestTrace = {
    kind: 'openai_sdk_chat_completions',
    stepIndex,
    model: config.model,
    stream,
    temperature: config.temperature ?? 0.2,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? {
          toolChoice: 'auto',
          tools: tools.map((tool) => cloneJsonValue(tool as unknown as JsonValue)),
        }
      : {}),
  };

  return [trace];
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
  let sawModelOutput = false;
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
          sawModelOutput = true;
        }

        for (const progressText of accumulateStreamingToolCallProgress(toolCalls, delta.tool_calls)) {
          yield { kind: 'tool-progress', text: progressText };
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          sawModelOutput = true;
          assistantContent += delta.content;
          yield { kind: 'assistant-chunk', text: delta.content };
        }

        if (typeof delta.refusal === 'string' && delta.refusal.length > 0) {
          sawModelOutput = true;
          assistantContent += delta.refusal;
          yield { kind: 'assistant-chunk', text: delta.refusal };
        }
      }
    }

    if (!sawModelOutput) {
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

function llmHistoryToOpenAiMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonValue[] {
  return history.map((message) => llmMessageToOpenAiMessage(message, assetRoot));
}

function llmMessageToOpenAiMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (message.role === 'user' && (message.imagePaths?.length ?? 0) > 0) {
    const parts: JsonValue[] = [];

    if (message.content.trim()) {
      parts.push({ type: 'text', text: message.content });
    }

    for (const imagePath of message.imagePaths ?? []) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: pathToImageUrl(imagePath, assetRoot),
        },
      });
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
    content: message.content,
  };
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
): string[] {
  if (!deltas || deltas.length === 0) {
    return [];
  }

  const updates: string[] = [];
  for (const delta of deltas) {
    const existing = toolCalls.get(delta.index);
    const current: AggregatedStreamingToolCall = existing ?? {
      index: delta.index,
      id: delta.id ?? `stream-tool-call-${delta.index}`,
      type: 'function',
      functionName: '',
      functionArguments: '',
      nameEmitted: false,
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

    if (current.functionName && !current.nameEmitted) {
      updates.push(buildToolProgressPreview(current.functionName, current.functionArguments));
      current.nameEmitted = true;
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

export function isOpenAiVisionUnsupportedError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    ((normalized.includes('image') || normalized.includes('vision') || normalized.includes('multimodal')) &&
      (normalized.includes('unsupported') ||
        normalized.includes('not support') ||
        normalized.includes('does not support') ||
        normalized.includes('not supported'))) ||
    (normalized.includes('base64') &&
      (normalized.includes('failed to process') ||
        normalized.includes('cannot process') ||
        normalized.includes('decode') ||
        normalized.includes('20015')))
  );
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function truncateMessageContentForRetry(
  role: JsonValue | undefined,
  content: string,
): string | undefined {
  if (role === 'tool') {
    return buildContextRetryExcerpt(
      content,
      TOOL_OUTPUT_RETRY_MAX_CHARS,
      '[tool output truncated for context retry]',
    );
  }

  if (role === 'system' && content.startsWith(TOOL_MEMORY_PREFIX)) {
    return buildContextRetryExcerpt(
      content,
      TOOL_MEMORY_RETRY_MAX_CHARS,
      '[tool memory truncated for context retry]',
    );
  }

  return undefined;
}

function buildContextRetryExcerpt(
  text: string,
  maxChars: number,
  label: string,
): string | undefined {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return undefined;
  }

  const totalLines = text.split(/\r?\n/).length;
  const overhead = Array.from(label).length + 160;
  const usable = Math.max(maxChars - overhead, 256);
  const headChars = Math.floor((usable * TOOL_TRUNCATION_HEAD_RATIO_NUM) / TOOL_TRUNCATION_HEAD_RATIO_DEN);
  const tailChars = Math.max(usable - headChars, 0);
  const head = takeFirstChars(text, headChars);
  const tail = takeLastChars(text, tailChars);
  const omittedChars = Math.max(chars.length - Array.from(head).length - Array.from(tail).length, 0);
  const omittedLines = Math.max(totalLines - head.split(/\r?\n/).length - tail.split(/\r?\n/).length, 0);

  return [
    head,
    `${label} omitted_chars=${omittedChars} omitted_lines≈${omittedLines}`,
    tail,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

function takeFirstChars(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function takeLastChars(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.slice(Math.max(chars.length - count, 0)).join('');
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, cloneJsonValue(entryValue)]),
  );
}

function findLastMatchingIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }

  return -1;
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

function escapeRuleAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildPrimarySystemMessage(rulesSystemMessage: string | undefined): string {
  return [TOOL_AGENT_SYSTEM_PROMPT, rulesSystemMessage]
    .filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
    .map((section) => section.trim())
    .join('\n\n');
}

function normalizeMessagesForRequest(messages: JsonValue[]): JsonValue[] {
  // 保持通用 BYOK 请求形态原样透传；若某个提供方不支持多 system message，应该放到专用适配器里处理。
  return messages.map((message) => cloneJsonValue(message));
}

function shouldInjectSyntheticToolReasoning(config: OpenAiTransportConfig): boolean {
  return !isMiniMaxCompatibleConfig(config);
}

function isMiniMaxCompatibleConfig(config: OpenAiTransportConfig): boolean {
  const normalizedModel = config.model.trim().toLowerCase();
  const normalizedBaseUrl = config.baseUrl?.trim().toLowerCase();

  return normalizedModel.startsWith('minimax') || normalizedBaseUrl?.includes('minimaxi.com') === true;
}

async function* emptyOpenAiEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}