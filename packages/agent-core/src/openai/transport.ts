import OpenAI from 'openai';
import type {
  ChatCompletionMessage,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

import type {
  JsonObject,
  JsonValue,
  LlmMessage,
  LlmTransport,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from '../ports.js';

const TOOL_AGENT_SYSTEM_PROMPT = [
  'You are Spirit Agent.',
  '',
  'Available tools are defined only by the tools field in this request.',
  'Only call declared functions.',
  'When the user clearly asks to inspect files, code, or environment, you may use tools.',
  'Do not invent tools or capabilities that are not present in the request.',
].join('\n');

const FINAL_RESPONSE_SYSTEM_PROMPT = 'You are Spirit Agent.';
const COMPACT_SUMMARY_PREFIX = '[SPIRIT_COMPACT_SUMMARY]';

export interface OpenAiTransportConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  temperature?: number;
  compactModel?: string;
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
  stream: false;
  toolChoice?: 'auto';
  temperature: number;
  messages: JsonValue[];
  tools?: JsonValue[];
}

export function startOpenAiToolAgentState(
  history: LlmMessage[],
  userInput: string,
): OpenAiToolAgentState {
  const messages: JsonValue[] = [
    {
      role: 'system',
      content: TOOL_AGENT_SYSTEM_PROMPT,
    },
    ...llmHistoryToOpenAiMessages(history),
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
    const requestTrace = buildRequestTrace(config, nextState, normalizedTools);

    const payload: ChatCompletionCreateParamsNonStreaming = {
      model: config.model,
      messages: nextState.messages as unknown as ChatCompletionMessageParam[],
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

      const assistantMessage = normalizeAssistantMessage(message);
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

    onProgress?.('OpenAI SDK: 正在生成会话摘要...');

    const client = createOpenAiClient(config);
    const response = await client.chat.completions.create({
      model: config.compactModel ?? config.model,
      temperature: 0.2,
      messages: [
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
      ],
    });

    const summary = response.choices.at(0)?.message?.content?.trim();
    if (!summary) {
      throw new Error('OpenAI SDK 压缩返回为空，无法生成摘要。');
    }

    history.splice(0, history.length, {
      role: 'system',
      content: `${COMPACT_SUMMARY_PREFIX}\n${summary}`,
      imagePaths: [],
    });

    onProgress?.('OpenAI SDK: 会话摘要生成完成。');

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

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return llmHistoryToOpenAiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: TOOL_AGENT_SYSTEM_PROMPT,
      final_response: FINAL_RESPONSE_SYSTEM_PROMPT,
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

function buildRequestTrace(
  config: OpenAiTransportConfig,
  state: OpenAiToolAgentState,
  tools: ChatCompletionTool[],
): JsonValue[] {
  const trace: OpenAiRequestTrace = {
    kind: 'openai_sdk_chat_completions',
    stepIndex: state.steps,
    model: config.model,
    stream: false,
    temperature: config.temperature ?? 0.2,
    messages: state.messages,
    ...(tools.length > 0
      ? {
          toolChoice: 'auto',
          tools: tools as unknown as JsonValue[],
        }
      : {}),
  };

  return [trace];
}

function llmHistoryToOpenAiMessages(history: LlmMessage[]): JsonValue[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
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

function normalizeAssistantMessage(message: ChatCompletionMessage): JsonValue {
  const functionToolCalls = extractFunctionToolCalls(message.tool_calls);

  return {
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
  };
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

function renderOpenAiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}