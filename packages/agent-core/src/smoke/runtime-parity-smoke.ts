import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AuthorizationDecision,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutor,
} from '../ports.js';
import { isOpenAiVisionUnsupportedError } from '../openai/transport.js';
import { AgentRuntime, pendingWorkspaceFilesFromInput, type RuntimeEvent } from '../runtime.js';

import { printSmokeSection } from './openai-shared.js';

interface ScriptedState {
  messages: JsonValue[];
  steps: number;
}

interface ScriptedToolRequest {
  name: string;
  argumentsJson: string;
}

class ApprovalExecutor implements ToolExecutor<ScriptedToolRequest> {
  executedCalls = 0;

  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(_message: string): Promise<ScriptedToolRequest> {
    throw new Error('ApprovalExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(request: ScriptedToolRequest): Promise<AuthorizationDecision> {
    if (request.name === 'write_file') {
      return {
        kind: 'need-approval',
        prompt: '写文件需要审批。',
      };
    }

    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(_request: ScriptedToolRequest): Promise<string> {
    this.executedCalls += 1;
    return 'unexpected execution';
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(): Promise<string> {
    throw new Error('ApprovalExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('ApprovalExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('ApprovalExecutor.readMcpResource 未实现。');
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('ApprovalExecutor.getMcpPrompt 未实现。');
  }
}

class ApprovalTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        kind: 'success',
        result: {
          state: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: '准备写文件。',
                tool_calls: [
                  {
                    id: 'call-write',
                    type: 'function',
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"demo.txt"}',
                    },
                  },
                ],
              },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: 'tool-calls',
            calls: [
              {
                id: 'call-write',
                name: 'write_file',
                argumentsJson: '{"path":"demo.txt"}',
              },
              {
                id: 'call-search',
                name: 'search_files',
                argumentsJson: '{"query":"should-not-run"}',
              },
            ],
          },
          requestTrace: [{ round: 1 }],
        },
      };
    }

    const hasGuidance = state.messages.some(
      (message) =>
        isJsonObject(message) && message.role === 'user' && message.content === '不要写文件，直接总结',
    );
    const hasDeniedTool = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('rejected by user guidance'),
    );

    if (!hasGuidance || !hasDeniedTool) {
      return {
        kind: 'failure',
        error: 'approval guidance 状态未正确写回。',
        requestTrace: [{ round: this.rounds }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'GUIDANCE_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ round: this.rounds }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class CompactExecutor implements ToolExecutor<ScriptedToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(_message: string): Promise<ScriptedToolRequest> {
    throw new Error('CompactExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: ScriptedToolRequest): Promise<string> {
    return `search result for ${request.argumentsJson}`;
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(): Promise<string> {
    throw new Error('CompactExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('CompactExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('CompactExecutor.readMcpResource 未实现。');
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('CompactExecutor.getMcpPrompt 未实现。');
  }
}

class CompactTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    const hasToolResult = state.messages.some(
      (message) => isJsonObject(message) && message.role === 'tool',
    );
    const hasSummary = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'system' &&
        message.content === '[SPIRIT_COMPACT_SUMMARY] compacted history',
    );

    if (!hasToolResult) {
      return {
        kind: 'success',
        result: {
          state: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: '先搜索。',
                tool_calls: [
                  {
                    id: 'call-search',
                    type: 'function',
                    function: {
                      name: 'search_files',
                      arguments: '{"query":"runtime parity"}',
                    },
                  },
                ],
              },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: 'tool-calls',
            calls: [
              {
                id: 'call-search',
                name: 'search_files',
                argumentsJson: '{"query":"runtime parity"}',
              },
            ],
          },
          requestTrace: [{ round: 1 }],
        },
      };
    }

    if (!hasSummary) {
      return {
        kind: 'failure',
        error: 'context overflow: too many tokens',
        requestTrace: [{ round: 2 }],
      };
    }

    const hasAssistantToolCall = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'assistant' &&
        Array.isArray(message.tool_calls) &&
        message.tool_calls.length > 0,
    );

    if (!hasAssistantToolCall) {
      return {
        kind: 'failure',
        error: 'compact retry 未保留 assistant tool-call state。',
        requestTrace: [{ round: this.rounds }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'COMPACT_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ round: this.rounds }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    const beforeLength = history.length;
    const lastUser = [...history].reverse().find((message) => message.role === 'user');
    history.splice(
      0,
      history.length,
      {
        role: 'system',
        content: '[SPIRIT_COMPACT_SUMMARY] compacted history',
        imagePaths: [],
      },
      ...(lastUser ? [lastUser] : []),
    );

    return {
      droppedMessages: Math.max(beforeLength - history.length, 0),
      beforeLength,
      afterLength: history.length,
    };
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return history.find((message) => message.content.startsWith('[SPIRIT_COMPACT_SUMMARY]'))?.content;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class BackgroundExecutor implements ToolExecutor<ScriptedToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(_message: string): Promise<ScriptedToolRequest> {
    throw new Error('BackgroundExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: ScriptedToolRequest): Promise<string> {
    await Promise.resolve();
    return `background result for ${request.argumentsJson}`;
  }

  shouldExecuteInBackground(request: ScriptedToolRequest): boolean {
    return request.name === 'search_files';
  }

  backgroundStatusText(request: ScriptedToolRequest): string | undefined {
    return request.name === 'search_files' ? '搜索中: runtime parity' : undefined;
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(): Promise<string> {
    throw new Error('BackgroundExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('BackgroundExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('BackgroundExecutor.readMcpResource 未实现。');
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('BackgroundExecutor.getMcpPrompt 未实现。');
  }
}

class BackgroundTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    const hasToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('background result'),
    );

    if (!hasToolResult) {
      return {
        kind: 'success',
        result: {
          state: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: '先后台搜索。',
                tool_calls: [
                  {
                    id: 'call-background-search',
                    type: 'function',
                    function: {
                      name: 'search_files',
                      arguments: '{"query":"runtime parity"}',
                    },
                  },
                ],
              },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: 'tool-calls',
            calls: [
              {
                id: 'call-background-search',
                name: 'search_files',
                argumentsJson: '{"query":"runtime parity"}',
              },
            ],
          },
          requestTrace: [{ round: 1 }],
        },
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'BACKGROUND_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ round: this.rounds }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class VisionExecutor implements ToolExecutor<ScriptedToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(_message: string): Promise<ScriptedToolRequest> {
    throw new Error('VisionExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(_request: ScriptedToolRequest): Promise<string> {
    return 'unused';
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(): Promise<string> {
    throw new Error('VisionExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('VisionExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('VisionExecutor.readMcpResource 未实现。');
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('VisionExecutor.getMcpPrompt 未实现。');
  }
}

class VisionTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    const hasUserImage = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'user' &&
        Array.isArray(message.image_paths) &&
        message.image_paths.length > 0,
    );

    if (hasUserImage) {
      return {
        kind: 'failure',
        error: 'Failed to process the base64 image (code 20015)',
        requestTrace: [{ round: this.rounds }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'VISION_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ round: this.rounds }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class FinalTextTransport implements LlmTransport<undefined, ScriptedState> {
  private readonly assistantText: string;
  private readonly validateState: ((state: ScriptedState) => void) | undefined;

  constructor(assistantText: string, validateState?: (state: ScriptedState) => void) {
    this.assistantText = assistantText;
    this.validateState = validateState;
  }

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    try {
      this.validateState?.(state);
    } catch (error) {
      return {
        kind: 'failure',
        error: error instanceof Error ? error.message : String(error),
        requestTrace: [{ messageCount: state.messages.length, steps: state.steps }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: this.assistantText }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ assistantText: this.assistantText }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class StreamingFinalTransport implements LlmTransport<undefined, ScriptedState> {
  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('StreamingFinalTransport 应走 streaming 路径。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    return {
      eventStream: streamFromEvents([
        { kind: 'thinking-chunk', text: 'thinking...' },
        { kind: 'tool-progress', text: 'searching workspace' },
        { kind: 'assistant-chunk', text: 'STREAM_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: (async () => {
        await flushMicrotasks();
        return {
          kind: 'success',
          result: {
            state: {
              messages: [...state.messages, { role: 'assistant', content: 'STREAM_OK' }],
              steps: state.steps + 1,
            },
            step: { kind: 'final-response-ready' },
            requestTrace: [{ mode: 'streaming-final' }],
          },
        };
      })(),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class WorkspaceContextTransport implements LlmTransport<undefined, ScriptedState> {
  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    const workspaceMessages = state.messages.flatMap((message) => {
      if (
        !isJsonObject(message) ||
        message.role !== 'system' ||
        typeof message.content !== 'string' ||
        !message.content.startsWith('[WORKSPACE_FILE]')
      ) {
        return [];
      }

      return [message.content];
    });
    const hasRuntimeContext = workspaceMessages.some(
      (content) =>
        content.includes('path: src/runtime.ts') &&
        content.includes('export const runtime = true;'),
    );
    const hasReadmeContext = workspaceMessages.some(
      (content) =>
        content.includes('path: README.md') &&
        content.includes('hello from readme'),
    );

    if (!hasRuntimeContext || !hasReadmeContext) {
      return {
        kind: 'failure',
        error: 'workspace file context 未注入到 tool-agent state。',
        requestTrace: [{ workspaceMessages }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'WORKSPACE_CONTEXT_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'workspace-context' }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class StreamingTimeoutTransport implements LlmTransport<undefined, ScriptedState> {
  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('StreamingTimeoutTransport 应走 streaming 路径。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'PARTIAL' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'PARTIAL' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'stream-timeout' }],
        },
      }),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class StreamingToolRoundTransport implements LlmTransport<undefined, ScriptedState> {
  private resolveCompletion:
    | ((completion: ToolAgentRoundCompletion<ScriptedState>) => void)
    | undefined;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'TOOL_ROUND_DONE' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'stream-tool-round-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    return {
      eventStream: streamFromEvents([]),
      completion: new Promise<ToolAgentRoundCompletion<ScriptedState>>((resolve) => {
        this.resolveCompletion = resolve;
      }),
      cancel: () => {
        this.resolveCompletion?.({
          kind: 'failure',
          error: 'cancelled',
          requestTrace: [],
        });
      },
    };
  }

  finish(state: ScriptedState): void {
    this.resolveCompletion?.({
      kind: 'success',
      result: {
        state,
        step: {
          kind: 'tool-calls',
          calls: [
            {
              id: 'call-stream-tool',
              name: 'search_files',
              argumentsJson: '{"query":"later"}',
            },
          ],
        },
        requestTrace: [{ mode: 'stream-tool-round' }],
      },
    });
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class HostExecutor implements ToolExecutor<ScriptedToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(message: string): Promise<ScriptedToolRequest> {
    if (message.includes('delete')) {
      return { name: 'delete_file', argumentsJson: '{"path":"demo.txt"}' };
    }

    if (message.includes('read')) {
      return { name: 'read_file', argumentsJson: '{"path":"demo.txt"}' };
    }

    throw new Error('unknown manual tool command');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(request: ScriptedToolRequest): Promise<AuthorizationDecision> {
    if (request.name === 'delete_file') {
      return {
        kind: 'need-approval',
        prompt: '删除文件需要审批。',
      };
    }

    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: ScriptedToolRequest): Promise<string> {
    return `manual output for ${request.name}`;
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(name: string): Promise<string> {
    return `/${name}.json`;
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('HostExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(_name: string, uri: string): Promise<JsonValue> {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: 'resource body',
        },
      ],
    };
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(_name: string, prompt: string): Promise<JsonValue> {
    return {
      messages: [
        {
          role: 'system',
          content: `prompt-system:${prompt}`,
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'prompt-user-message',
          },
        },
      ],
    };
  }
}

async function main(): Promise<void> {
  const backgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const visionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const timeoutEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const approvalExecutor = new ApprovalExecutor();
  const approvalRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new ApprovalTransport(),
    toolExecutor: approvalExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const approvalResult = await approvalRuntime.submitUserTurn('请直接写文件。');
  if (approvalResult.kind !== 'requires-approval') {
    throw new Error(`approval smoke 期望 requires-approval，实际为 ${approvalResult.kind}`);
  }

  const approvalCompleted = await approvalRuntime.resumePendingApproval({
    kind: 'guidance',
    userMessage: '不要写文件，直接总结',
  });

  if (approvalCompleted.kind !== 'completed' || approvalCompleted.assistantText !== 'GUIDANCE_OK') {
    throw new Error('approval guidance smoke 未完成闭环。');
  }

  if (approvalExecutor.executedCalls !== 0) {
    throw new Error('approval guidance smoke 中不应执行任何工具。');
  }

  const compactRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new CompactTransport(),
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateStateForContextRetry: truncateScriptedStateForContextRetry,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
  }, [
    {
      role: 'system',
      content: '[TOOL_MEMORY]\nrequest: old\nresult_snippet:\n' + 'x'.repeat(5000),
      imagePaths: [],
    },
    {
      role: 'assistant',
      content: '旧回答。',
      imagePaths: [],
    },
  ]);

  const compactResult = await compactRuntime.submitUserTurn('继续处理 runtime parity。');
  if (compactResult.kind !== 'completed' || compactResult.assistantText !== 'COMPACT_OK') {
    throw new Error('compact retry smoke 未完成闭环。');
  }

  const firstCompaction = compactResult.compactions.at(0);
  if (compactResult.compactions.length !== 1 || !firstCompaction || firstCompaction.droppedMessages <= 0) {
    throw new Error('compact retry smoke 未记录有效压缩。');
  }

  const backgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new BackgroundTransport(),
    toolExecutor: new BackgroundExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => backgroundEvents.push(event),
  });

  const backgroundResult = await backgroundRuntime.submitUserTurn('请后台搜索 runtime parity。');
  if (backgroundResult.kind !== 'completed' || backgroundResult.assistantText !== 'BACKGROUND_OK') {
    throw new Error('background execution smoke 未完成闭环。');
  }

  const startedBackground = backgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'started',
  );
  const finishedBackground = backgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'finished',
  );
  if (!startedBackground || !finishedBackground) {
    throw new Error('background execution smoke 未收到开始/结束事件。');
  }
  if (startedBackground.statusText !== '搜索中: runtime parity') {
    throw new Error('background execution smoke 状态文本不正确。');
  }
  if (backgroundRuntime.backgroundToolStatus() !== undefined) {
    throw new Error('background execution smoke 结束后应清空 pending background status。');
  }

  const visionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new VisionTransport(),
    toolExecutor: new VisionExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    isVisionUnsupportedError: isOpenAiVisionUnsupportedError,
    onEvent: (event) => visionEvents.push(event),
  });

  const visionResult = await visionRuntime.submitUserTurn('请描述这张图。', ['fixtures/demo.png']);
  if (visionResult.kind !== 'completed' || visionResult.assistantText !== 'VISION_OK') {
    throw new Error('vision fallback smoke 未完成闭环。');
  }

  const visionEvent = visionEvents.find((event) => event.kind === 'vision-fallback-retry');
  if (!visionEvent || visionEvent.droppedImages !== 1) {
    throw new Error('vision fallback smoke 未记录正确的降级事件。');
  }
  const visionUserHistory = visionRuntime.history().find(
    (message) => message.role === 'user' && message.content === '请描述这张图。',
  );
  if (!visionUserHistory || (visionUserHistory.imagePaths?.length ?? 0) !== 0) {
    throw new Error('vision fallback smoke 未清空 user imagePaths。');
  }

  const hostRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('MANUAL_GUIDANCE_OK'),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const manualAllowed = await hostRuntime.executeManualToolCommand('/tool read demo.txt');
  if (manualAllowed.kind !== 'completed' || manualAllowed.output !== 'manual output for read_file') {
    throw new Error('manual tool allowed smoke 未完成。');
  }

  const manualApproval = await hostRuntime.executeManualToolCommand('/tool delete demo.txt');
  if (manualApproval.kind !== 'requires-approval') {
    throw new Error('manual tool approval smoke 未进入审批。');
  }

  const manualGuidance = await hostRuntime.resumePendingManualToolApproval({
    kind: 'guidance',
    userMessage: '别删文件，先给总结',
  });
  if (manualGuidance.kind !== 'submitted-user-turn') {
    throw new Error('manual guidance smoke 未转交为 user turn。');
  }
  if (
    manualGuidance.result.kind !== 'completed' ||
    manualGuidance.result.assistantText !== 'MANUAL_GUIDANCE_OK'
  ) {
    throw new Error('manual guidance smoke 未跑通最终回复。');
  }

  const promptRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('PROMPT_OK', (state) => {
      if (!state.messages.some((message) => isJsonObject(message) && message.content === 'prompt-system:analysis')) {
        throw new Error('prompt system message 未注入 state。');
      }
      if (!state.messages.some((message) => isJsonObject(message) && message.content === 'prompt-user-message')) {
        throw new Error('prompt user message 未注入 state。');
      }
    }),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const promptApplied = await promptRuntime.applyMcpPrompt('demo', 'analysis');
  if (promptApplied.result.kind !== 'completed' || promptApplied.result.assistantText !== 'PROMPT_OK') {
    throw new Error('applyMcpPrompt smoke 未完成闭环。');
  }
  if (!promptApplied.notice.includes('已应用 MCP prompt: demo / analysis')) {
    throw new Error('applyMcpPrompt smoke notice 不正确。');
  }

  const resourceRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('RESOURCE_OK', (state) => {
      if (
        !state.messages.some(
          (message) =>
            isJsonObject(message) &&
            typeof message.content === 'string' &&
            message.content.startsWith('[MCP_RESOURCE]'),
        )
      ) {
        throw new Error('MCP resource context 未注入 state。');
      }
    }),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const resourceLabel = await resourceRuntime.attachMcpResource('demo', 'mcp://demo/doc');
  if (resourceLabel !== 'demo -> mcp://demo/doc') {
    throw new Error('attachMcpResource smoke label 不正确。');
  }
  const resourceResult = await resourceRuntime.submitUserTurn('结合资源回答');
  if (resourceResult.kind !== 'completed' || resourceResult.assistantText !== 'RESOURCE_OK') {
    throw new Error('attachMcpResource smoke 未完成闭环。');
  }
  if (resourceRuntime.pendingMcpResources().length !== 0) {
    throw new Error('attachMcpResource smoke 提交后应清空 pending resources。');
  }

  const archive = resourceRuntime.toArchive(
    [{ role: 'user', content: 'u' }],
    [],
  );
  const restoredRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('RESTORED_OK'),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });
  restoredRuntime.replaceFromArchive(archive);
  if (restoredRuntime.history().length !== archive.llmHistory.length) {
    throw new Error('replaceFromArchive smoke 未恢复 llmHistory。');
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-runtime-'));
  let workspaceFileSmoke: JsonValue;
  try {
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src', 'runtime.ts'), 'export const runtime = true;\n');
    await writeFile(join(workspaceRoot, 'README.md'), 'hello from readme\n');
    await writeFile(join(workspaceRoot, 'large.txt'), 'x'.repeat(24_050));

    const referencedFiles = await pendingWorkspaceFilesFromInput(
      workspaceRoot,
      '@src/runtime.ts 请参考 @README.md 和 @missing.rs 以及 @large.txt',
    );
    const referencedPaths = referencedFiles.map((file) => file.path);
    if (referencedPaths.join('|') !== 'src/runtime.ts|README.md|large.txt') {
      throw new Error('workspace file helper smoke 未按预期提取现有引用。');
    }

    const largeFile = referencedFiles.find((file) => file.path === 'large.txt');
    if (!largeFile || !largeFile.truncated || !largeFile.content.endsWith('...<文件内容已截断>')) {
      throw new Error('workspace file helper smoke 未按预期截断超长文件。');
    }

    const workspaceRuntime = new AgentRuntime({
      config: undefined,
      llmTransport: new WorkspaceContextTransport(),
      toolExecutor: new HostExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    });

    const workspaceResult = await workspaceRuntime.submitUserTurn(
      '@src/runtime.ts 请结合 @README.md 总结',
    );
    if (
      workspaceResult.kind !== 'completed' ||
      workspaceResult.assistantText !== 'WORKSPACE_CONTEXT_OK'
    ) {
      throw new Error('workspace file context smoke 未完成闭环。');
    }

    const injectedContexts = workspaceRuntime.history().filter(
      (message) =>
        message.role === 'system' && message.content.startsWith('[WORKSPACE_FILE]'),
    );
    if (injectedContexts.length !== 2) {
      throw new Error('workspace file context smoke 注入的 system context 数量不正确。');
    }

    workspaceFileSmoke = {
      referencedPaths,
      truncatedLargeFile: largeFile.truncated,
      injectedContexts: injectedContexts.length,
      assistantText: workspaceResult.assistantText,
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  const streamingRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFinalTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingEvents.push(event),
  });

  await streamingRuntime.startUserTurnStreaming('请流式输出');
  for (let index = 0; index < 24 && streamingRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingRuntime.poll();
  }

  if (streamingRuntime.isBusy()) {
    throw new Error('streaming final smoke 未在预期轮次内完成。');
  }

  const drainedStreamingEvents = streamingRuntime.drainEvents();
  if (!drainedStreamingEvents.some((event) => event.kind === 'begin-assistant-response')) {
    throw new Error('streaming final smoke 缺少 begin event。');
  }
  if (
    !drainedStreamingEvents.some(
      (event) => event.kind === 'update-pending-assistant-thinking' && event.text.includes('searching workspace'),
    )
  ) {
    throw new Error('streaming final smoke 缺少 thinking/tool-progress 聚合事件。');
  }
  if (
    drainedStreamingEvents.filter((event) => event.kind === 'assistant-chunk').length < 2
  ) {
    throw new Error('streaming final smoke 缺少 assistant chunk 事件。');
  }
  if (!drainedStreamingEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('streaming final smoke 缺少 completed event。');
  }

  const timeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingTimeoutTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => timeoutEvents.push(event),
  });

  await timeoutRuntime.startUserTurnStreaming('请等待超时');
  await flushMicrotasks();
  await timeoutRuntime.poll();
  timeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  const drainedTimeoutEvents = timeoutRuntime.drainEvents();
  if (
    !drainedTimeoutEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text.includes('[stream timeout]'),
    )
  ) {
    throw new Error('stream timeout smoke 未产生 timeout chunk。');
  }
  if (!drainedTimeoutEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('stream timeout smoke 未完成 pending response。');
  }

  const toolRoundTransport = new StreamingToolRoundTransport();
  const noTimeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: toolRoundTransport,
    toolExecutor: new BackgroundExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  await noTimeoutRuntime.startUserTurnStreaming('这是一个 tool round');
  noTimeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  if (!noTimeoutRuntime.isBusy()) {
    throw new Error('tool round timeout smoke 不应在 decision 未完成时超时退出。');
  }
  toolRoundTransport.finish(createScriptedState(noTimeoutRuntime.history() as LlmMessage[], '这是一个 tool round'));
  await flushMicrotasks();
  await noTimeoutRuntime.poll();

  printSmokeSection('approval guidance smoke', approvalCompleted);
  printSmokeSection('compact retry smoke', compactResult);
  printSmokeSection('background execution smoke', backgroundResult);
  printSmokeSection('vision fallback smoke', visionResult);
  printSmokeSection('manual command smoke', manualGuidance);
  printSmokeSection('mcp prompt smoke', promptApplied);
  printSmokeSection('mcp resource smoke', resourceResult);
  printSmokeSection('archive restore smoke', archive);
  printSmokeSection('workspace file context smoke', workspaceFileSmoke);
  printSmokeSection('streaming final smoke events', drainedStreamingEvents);
  printSmokeSection('stream timeout smoke events', drainedTimeoutEvents);
}

function createScriptedState(history: LlmMessage[], userInput: string): ScriptedState {
  const messages: JsonValue[] = [
    { role: 'system', content: 'scripted-runtime' },
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
      ...((message.role === 'user' && (message.imagePaths?.length ?? 0) > 0)
        ? { image_paths: [...(message.imagePaths ?? [])] }
        : {}),
    })),
  ];

  const last = messages.at(-1);
  if (!isJsonObject(last) || last.role !== 'user') {
    messages.push({ role: 'user', content: userInput });
  }

  return { messages, steps: 0 };
}

function appendScriptedToolResult(
  state: ScriptedState,
  toolCallId: string,
  content: string,
): ScriptedState {
  return {
    messages: [...state.messages, { role: 'tool', tool_call_id: toolCallId, content }],
    steps: state.steps,
  };
}

function appendScriptedUserMessage(state: ScriptedState, content: string): ScriptedState {
  return {
    messages: [...state.messages, { role: 'user', content }],
    steps: state.steps,
  };
}

function extractScriptedAssistantText(state: ScriptedState): string | undefined {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (isJsonObject(message) && message.role === 'assistant' && typeof message.content === 'string') {
      return message.content;
    }
  }

  return undefined;
}

function truncateScriptedStateForContextRetry(
  state: ScriptedState,
): { state: ScriptedState; changed: boolean } {
  let changed = false;
  const messages = state.messages.map((message) => {
    if (!isJsonObject(message) || typeof message.content !== 'string') {
      return cloneJsonValue(message);
    }

    if (message.role !== 'tool' || message.content.length <= 80) {
      return { ...message };
    }

    changed = true;
    return {
      ...message,
      content: `${message.content.slice(0, 40)}...[tool output truncated for context retry]...${message.content.slice(-20)}`,
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

function truncateScriptedHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  let changed = false;
  const nextHistory = history.map((message) => {
    if (message.role !== 'system' || !message.content.startsWith('[TOOL_MEMORY]')) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    if (message.content.length <= 200) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    changed = true;
    return {
      role: message.role,
      content: `${message.content.slice(0, 120)}...[tool memory truncated for context retry]`,
      imagePaths: [...(message.imagePaths ?? [])],
    };
  });

  return {
    history: nextHistory,
    changed,
  };
}

function rebuildScriptedStateAfterCompaction(
  history: LlmMessage[],
  userInput: string,
  retryState: ScriptedState,
): ScriptedState {
  const rebuilt = createScriptedState(history, userInput);
  rebuilt.steps = retryState.steps;

  for (let index = retryState.messages.length - 1; index >= 0; index -= 1) {
    const message = retryState.messages[index];
    if (isJsonObject(message) && message.role === 'user' && message.content === userInput) {
      rebuilt.messages.push(...retryState.messages.slice(index + 1).map((item) => cloneJsonValue(item)));
      return rebuilt;
    }
  }

  return {
    messages: retryState.messages.map((message) => cloneJsonValue(message)),
    steps: retryState.steps,
  };
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

async function* streamFromEvents(events: LlmStreamEvent[]): AsyncIterable<LlmStreamEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`runtime parity smoke failed: ${message}`);
  process.exitCode = 1;
});