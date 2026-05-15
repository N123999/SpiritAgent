import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AuthorizationDecision,
  ToolExecutionOutput,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutor,
} from '../../../../ports.js';
import {
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  createLlmMessageContentFromTextAndImages,
  createToolExecutionTextOutput,
  llmMessageHasImages,
  llmMessageImagePaths,
  llmMessageTextContent,
} from '../../../../ports.js';
import { isOpenAiVisionUnsupportedError } from '../../../../openai/tool-agent-helpers.js';
import {
  AgentRuntime,
  pendingWorkspaceFilesFromInput,
  type RuntimeEvent,
  type RuntimeTurnResult,
} from '../../../../runtime.js';
import { userMessageContentMatchesInput } from '../../../../runtime/user-turn-timestamp.js';

export interface ScriptedState {
  messages: JsonValue[];
  steps: number;
}

export interface ScriptedToolRequest {
  name: string;
  argumentsJson: string;
}

export function historyAsPlainApiMessages(history: LlmMessage[]): JsonValue[] {
  return history.map((message) => ({
    role: message.role,
    content: llmMessageTextContent(message.content),
    ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
  }));
}

export function compactSummaryFromHistory(history: LlmMessage[]): string | undefined {
  const summary = history.find((message) =>
    llmMessageTextContent(message.content).startsWith('[SPIRIT_COMPACT_SUMMARY]'),
  );
  return summary ? llmMessageTextContent(summary.content) : undefined;
}

export class ApprovalExecutor implements ToolExecutor<ScriptedToolRequest> {
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
    if (request.name === 'create_file') {
      return {
        kind: 'need-approval',
        prompt: '写文件需要审批。',
      };
    }

    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(_request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return createToolExecutionTextOutput('unexpected execution');
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

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('ApprovalExecutor.getMcpPrompt 未实现。');
  }
}

export class ApprovalTransport implements LlmTransport<undefined, ScriptedState> {
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
                      name: 'create_file',
                      arguments: '{"path":"demo.txt","content":"x"}',
                    },
                  },
                  {
                    id: 'call-search',
                    type: 'function',
                    function: {
                      name: 'grep',
                      arguments: '{"query":"should-not-run"}',
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
                name: 'create_file',
                argumentsJson: '{"path":"demo.txt","content":"x"}',
              },
              {
                id: 'call-search',
                name: 'grep',
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
        isJsonObject(message) &&
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('不要写文件，直接总结'),
    );
    const hasDeniedTool = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-write' &&
        typeof message.content === 'string' &&
        message.content.includes('rejected by user guidance'),
    );
    const hasQueuedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-search' &&
        typeof message.content === 'string' &&
        message.content === 'unexpected execution',
    );

    if (!hasGuidance || !hasDeniedTool || !hasQueuedToolResult) {
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
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class CompactExecutor implements ToolExecutor<ScriptedToolRequest> {
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

  async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    return createToolExecutionTextOutput(`search result for ${request.argumentsJson}`);
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

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('CompactExecutor.getMcpPrompt 未实现。');
  }
}

export class CompactTransport implements LlmTransport<undefined, ScriptedState> {
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
                      name: 'grep',
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
                name: 'grep',
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
          content: createLlmMessageContentFromText('[SPIRIT_COMPACT_SUMMARY] compacted history'),
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
      return compactSummaryFromHistory(history);
    }

    isContextOverflowError(error: string): boolean {
      return error.includes('context overflow');
    }

    llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
      return historyAsPlainApiMessages(history);
    }

    llmSystemPromptsForExport(): JsonValue {
      return {};
    }
  }

export class PollingCompactTransport extends CompactTransport {
  private resolveCompaction: (() => void) | undefined;

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    const beforeLength = history.length;

    return new Promise((resolve) => {
      this.resolveCompaction = () => {
        const lastUser = [...history].reverse().find((message) => message.role === 'user');
        history.splice(
          0,
          history.length,
          {
            role: 'system',
            content: createLlmMessageContentFromText('[SPIRIT_COMPACT_SUMMARY] compacted history'),
          },
          ...(lastUser ? [lastUser] : []),
        );

        resolve({
          droppedMessages: Math.max(beforeLength - history.length, 0),
          beforeLength,
          afterLength: history.length,
        });
      };
    });
  }

  finishCompaction(): void {
    this.resolveCompaction?.();
  }
}

export class ProgressManualCompactionTransport extends CompactTransport {
  private resolveCompaction: (() => void) | undefined;
  private progressCallback: ((message: string) => void) | undefined;

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    const beforeLength = history.length;
    this.progressCallback = onProgress;

    return new Promise((resolve) => {
      this.resolveCompaction = () => {
        this.progressCallback?.('[SPIRIT_COMPACT_PROGRESS] compacting history');
        const lastUser = [...history].reverse().find((message) => message.role === 'user');
        history.splice(
          0,
          history.length,
          {
            role: 'system',
            content: createLlmMessageContentFromText('[SPIRIT_COMPACT_SUMMARY] compacted history'),
          },
          ...(lastUser ? [lastUser] : []),
        );

        resolve({
          droppedMessages: Math.max(beforeLength - history.length, 0),
          beforeLength,
          afterLength: history.length,
        });
      };
    });
  }

  finishCompaction(): void {
    this.resolveCompaction?.();
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return compactSummaryFromHistory(history);
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class BackgroundExecutor implements ToolExecutor<ScriptedToolRequest> {
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

  async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    await Promise.resolve();
    return createToolExecutionTextOutput(`background result for ${request.argumentsJson}`);
  }

  shouldExecuteInBackground(request: ScriptedToolRequest): boolean {
    return request.name === 'grep';
  }

  backgroundStatusText(request: ScriptedToolRequest): string | undefined {
    return request.name === 'grep' ? '搜索中: runtime parity' : undefined;
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

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('BackgroundExecutor.getMcpPrompt 未实现。');
  }
}

export class PollingBackgroundExecutor extends BackgroundExecutor {
  private readonly deferred = createDeferred<ToolExecutionOutput>();

  async execute(_request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    return this.deferred.promise;
  }

  finish(output: string): void {
    this.deferred.resolve(createToolExecutionTextOutput(output));
  }
}

export class BackgroundTransport implements LlmTransport<undefined, ScriptedState> {
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
                      name: 'grep',
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
                name: 'grep',
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

export class VisionExecutor implements ToolExecutor<ScriptedToolRequest> {
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

  async execute(_request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    return createToolExecutionTextOutput('unused');
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

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('VisionExecutor.getMcpPrompt 未实现。');
  }
}

export class VisionTransport implements LlmTransport<undefined, ScriptedState> {
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

export class FinalTextTransport implements LlmTransport<undefined, ScriptedState> {
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

export class ToolImageProjectionTransport implements LlmTransport<undefined, ScriptedState> {
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
              { role: 'assistant', content: '先读取图片。' },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: 'tool-calls',
            calls: [{ id: 'call-read-image', name: 'read_file', argumentsJson: '{"path":"tool-image.png"}' }],
          },
          requestTrace: [{ round: 1 }],
        },
      };
    }

    const hasProjectedImageUserMessage = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('[read image]') &&
        Array.isArray(message.image_paths) &&
        message.image_paths.includes('tool-image.png'),
    );
    if (!hasProjectedImageUserMessage) {
      throw new Error('tool image projection smoke 未把工具图片输出投影到下一拍 user 消息。');
    }

    const hasToolSummary = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('[read image]'),
    );
    if (!hasToolSummary) {
      throw new Error('tool image projection smoke 未保留工具结果摘要。');
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'TOOL_IMAGE_PROJECTION_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ round: 2 }],
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
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class SubagentTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;

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
                content: '准备委托子代理。',
                tool_calls: [
                  {
                    id: 'call-subagent',
                    type: 'function',
                    function: {
                      name: 'run_subagent',
                      arguments: '{"task":"输出：好的，我是 SubAgent，哈哈哈"}',
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
                id: 'call-subagent',
                name: 'run_subagent',
                argumentsJson: '{"task":"输出：好的，我是 SubAgent，哈哈哈"}',
              },
            ],
          },
          requestTrace: [{ mode: 'subagent-parent-round-1' }],
        },
      };
    }

    if (this.rounds === 2) {
      const delegatedPromptPresent = state.messages.some(
        (message) =>
          isJsonObject(message)
          && message.role === 'user'
          && typeof message.content === 'string'
          && message.content.includes('You are already inside the delegated child session.'),
      );
      if (!delegatedPromptPresent) {
        return {
          kind: 'failure',
          error: 'subagent child round 未收到委托后的 user turn。',
          requestTrace: [{ mode: 'subagent-child-round-missing-user-turn' }],
        };
      }

      return {
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: '好的，我是 SubAgent，哈哈哈' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'subagent-child-round' }],
        },
      };
    }

    const toolResultMessage = state.messages.find(
      (message) =>
        isJsonObject(message)
        && message.role === 'tool'
        && message.tool_call_id === 'call-subagent'
        && typeof message.content === 'string',
    );
    if (
      !toolResultMessage
      || !isJsonObject(toolResultMessage)
      || typeof toolResultMessage.content !== 'string'
      || !toolResultMessage.content.includes('好的，我是 SubAgent，哈哈哈')
    ) {
      return {
        kind: 'failure',
        error: 'subagent parent round 未收到子代理结果。',
        requestTrace: [{ mode: 'subagent-parent-round-2-missing-tool-result' }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'SUBAGENT_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'subagent-parent-round-2' }],
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

export class StreamingFinalTransport implements LlmTransport<undefined, ScriptedState> {
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

export class WorkspaceContextTransport implements LlmTransport<undefined, ScriptedState> {
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

export class StreamingTimeoutTransport implements LlmTransport<undefined, ScriptedState> {
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

export class StreamingFailureTransport implements LlmTransport<undefined, ScriptedState> {
  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('StreamingFailureTransport 应走 streaming 路径。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: 'failure',
        error: '400 invalid params, invalid chat setting (2013)',
        requestTrace: [{ mode: 'streaming-failure' }],
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

export class StreamingToolRoundTransport implements LlmTransport<undefined, ScriptedState> {
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
              name: 'grep',
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

export class StreamingBackgroundRoundTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_BACKGROUND_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-background-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: '先触发后台搜索。',
                  tool_calls: [
                    {
                      id: 'call-stream-background',
                      type: 'function',
                      function: {
                        name: 'grep',
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
                  id: 'call-stream-background',
                  name: 'grep',
                  argumentsJson: '{"query":"runtime parity"}',
                },
              ],
            },
            requestTrace: [{ mode: 'streaming-background-round-1' }],
          },
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_BG_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_BG_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-background-round-2' }],
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
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class StreamingApprovalExecutor implements ToolExecutor<ScriptedToolRequest> {
  executedCalls = 0;

  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(_message: string): Promise<ScriptedToolRequest> {
    throw new Error('StreamingApprovalExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<ScriptedToolRequest> {
    return { name, argumentsJson };
  }

  async authorize(request: ScriptedToolRequest): Promise<AuthorizationDecision> {
    if (request.name === 'create_file') {
      return {
        kind: 'need-approval',
        prompt: '写文件需要审批。',
      };
    }

    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return createToolExecutionTextOutput(`approved output for ${request.name}`);
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
    throw new Error('StreamingApprovalExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('StreamingApprovalExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('StreamingApprovalExecutor.readMcpResource 未实现。');
  }

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('StreamingApprovalExecutor.getMcpPrompt 未实现。');
  }
}

export class StreamingApprovalTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-approval-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: '先申请写文件权限。',
                  tool_calls: [
                    {
                      id: 'call-stream-approval',
                      type: 'function',
                      function: {
                        name: 'create_file',
                        arguments: '{"path":"demo.txt","content":"x"}',
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
                  id: 'call-stream-approval',
                  name: 'create_file',
                  argumentsJson: '{"path":"demo.txt","content":"x"}',
                },
              ],
            },
            requestTrace: [{ mode: 'streaming-approval-round-1' }],
          },
        }),
      };
    }

    const hasApprovedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content === 'approved output for create_file',
    );

    if (!hasApprovedToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming approval resume 未写回 tool result。',
          requestTrace: [{ mode: 'streaming-approval-round-2-missing-tool-result' }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_APPROVAL_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-approval-round-2' }],
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
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class StreamingApprovalImageExecutor extends StreamingApprovalExecutor {
  override async authorize(request: ScriptedToolRequest): Promise<AuthorizationDecision> {
    if (request.name === 'read_file') {
      return {
        kind: 'need-approval',
        prompt: '读取图片需要审批。',
      };
    }

    return { kind: 'allowed' };
  }

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    if (request.name !== 'read_file') {
      return createToolExecutionTextOutput(`approved output for ${request.name}`);
    }

    const summaryText = '[read image]\npath: approved-image.png\n\n图像文件已作为图片输入返回。';
    return {
      summaryText,
      content: createLlmMessageContentFromTextAndImages(summaryText, ['approved-image.png']),
    };
  }
}

export class StreamingApprovalImageTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_IMAGE_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-approval-image-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: '先申请读取图片权限。',
                  tool_calls: [
                    {
                      id: 'call-stream-approval-image',
                      type: 'function',
                      function: {
                        name: 'read_file',
                        arguments: '{"path":"approved-image.png"}',
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
                  id: 'call-stream-approval-image',
                  name: 'read_file',
                  argumentsJson: '{"path":"approved-image.png"}',
                },
              ],
            },
            requestTrace: [{ mode: 'streaming-approval-image-round-1' }],
          },
        }),
      };
    }

    const hasApprovedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('[read image]') &&
        message.content.includes('approved-image.png'),
    );
    if (!hasApprovedToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming approval image resume 未写回图片 tool result。',
          requestTrace: [{ mode: 'streaming-approval-image-round-2-missing-tool-result' }],
        }),
      };
    }

    const hasProjectedImageUserMessage = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('[read image]') &&
        Array.isArray(message.image_paths) &&
        message.image_paths.includes('approved-image.png'),
    );
    if (!hasProjectedImageUserMessage) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming approval image resume 未把图片工具输出投影到下一拍 user 消息。',
          requestTrace: [{ mode: 'streaming-approval-image-round-2-missing-projection' }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_APPROVAL_IMAGE_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_IMAGE_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-approval-image-round-2' }],
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
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}


export class StreamingApprovalGuidanceTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_GUIDANCE_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-guidance-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: '先申请写文件权限。',
                  tool_calls: [
                    {
                      id: 'call-stream-guidance-write',
                      type: 'function',
                      function: {
                        name: 'create_file',
                        arguments: '{"path":"demo.txt","content":"x"}',
                      },
                    },
                    {
                      id: 'call-stream-guidance-search',
                      type: 'function',
                      function: {
                        name: 'grep',
                        arguments: '{"query":"should-not-run"}',
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
                  id: 'call-stream-guidance-write',
                  name: 'create_file',
                  argumentsJson: '{"path":"demo.txt","content":"x"}',
                },
                {
                  id: 'call-stream-guidance-search',
                  name: 'grep',
                  argumentsJson: '{"query":"should-not-run"}',
                },
              ],
            },
            requestTrace: [{ mode: 'streaming-guidance-round-1' }],
          },
        }),
      };
    }

    const hasGuidance = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.includes('不要写文件，直接总结'),
    );
    const hasDeniedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-stream-guidance-write' &&
        typeof message.content === 'string' &&
        message.content.includes('rejected by user guidance'),
    );
    const hasQueuedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-stream-guidance-search' &&
        typeof message.content === 'string' &&
        message.content === 'approved output for grep',
    );

    if (!hasGuidance || !hasDeniedToolResult || !hasQueuedToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming guidance resume 未正确继续后续排队工具。',
          requestTrace: [{ mode: 'streaming-guidance-round-2-missing-tool-results' }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_GUIDANCE_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_GUIDANCE_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-guidance-round-2' }],
        },
      }),
      cancel: () => {},
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
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class StreamingCompactionTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;
  private resolveCompaction: (() => void) | undefined;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_COMPACT_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-compact-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'PARTIAL_BEFORE_COMPACT' },
          { kind: 'error', error: 'context overflow: streaming too large' },
        ]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'context overflow: streaming too large',
          requestTrace: [{ mode: 'streaming-compact-round-1' }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_COMPACT_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_COMPACT_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-compact-round-2' }],
        },
      }),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    const beforeLength = history.length;

    return new Promise((resolve) => {
      this.resolveCompaction = () => {
        const lastUser = [...history].reverse().find((message) => message.role === 'user');
        history.splice(
          0,
          history.length,
          {
            role: 'system',
            content: createLlmMessageContentFromText('[SPIRIT_COMPACT_SUMMARY] compacted history'),
          },
          ...(lastUser ? [lastUser] : []),
        );

        resolve({
          droppedMessages: Math.max(beforeLength - history.length, 0),
          beforeLength,
          afterLength: history.length,
        });
      };
    });
  }

  finishCompaction(): void {
    this.resolveCompaction?.();
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return compactSummaryFromHistory(history);
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context overflow');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return history.map((message) => ({ role: message.role, content: message.content }));
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

export class HostExecutor implements ToolExecutor<ScriptedToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(message: string): Promise<ScriptedToolRequest> {
    if (message.includes('delete')) {
      return { name: 'delete_file', argumentsJson: '{"path":"demo.txt"}' };
    }

    if (message.includes('search')) {
      return { name: 'grep', argumentsJson: '{"query":"runtime parity"}' };
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

  async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    return createToolExecutionTextOutput(`manual output for ${request.name}`);
  }

  shouldExecuteInBackground(request: ScriptedToolRequest): boolean {
    return request.name === 'grep';
  }

  backgroundStatusText(request: ScriptedToolRequest): string | undefined {
    if (request.name === 'grep') {
      return '搜索中: runtime parity';
    }

    return undefined;
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

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
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

export class ToolImageProjectionExecutor extends HostExecutor {
  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    if (request.name !== 'read_file') {
      return super.execute(request);
    }

    const summaryText = '[read image]\npath: tool-image.png\n\n图像文件已作为图片输入返回。';
    return {
      summaryText,
      content: createLlmMessageContentFromTextAndImages(summaryText, ['tool-image.png']),
    };
  }
}

export class SubagentExecutor extends HostExecutor {
  executedSubagentCalls = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    if (request.name === 'run_subagent') {
      this.executedSubagentCalls += 1;
      throw new Error('run_subagent 不应落到宿主 execute');
    }

    return super.execute(request);
  }
}

export class PollingManualBackgroundExecutor extends HostExecutor {
  private readonly deferred = createDeferred<ToolExecutionOutput>();

  async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    if (request.name === 'grep') {
      return this.deferred.promise;
    }

    return super.execute(request);
  }

  finish(output: string): void {
    this.deferred.resolve(createToolExecutionTextOutput(output));
  }
}



export function createScriptedState(history: LlmMessage[], userInput: string): ScriptedState {
  const messages: JsonValue[] = [
    { role: 'system', content: 'scripted-runtime' },
    ...history.map((message) => ({
      role: message.role,
      content: llmMessageTextContent(message.content),
      ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
      ...((message.role === 'user' && llmMessageHasImages(message.content))
        ? {
            image_paths: message.content
              .filter((part): part is { type: 'image'; path: string } => part.type === 'image')
              .map((part) => part.path),
          }
        : {}),
    })),
  ];

  const last = messages.at(-1);
  if (!isJsonObject(last) || last.role !== 'user') {
    messages.push({ role: 'user', content: userInput });
  }

  return { messages, steps: 0 };
}

export function appendScriptedToolResult(
  state: ScriptedState,
  toolCallId: string,
  content: string,
): ScriptedState {
  return {
    messages: [...state.messages, { role: 'tool', tool_call_id: toolCallId, content }],
    steps: state.steps,
  };
}

export function appendScriptedUserMessage(state: ScriptedState, content: string): ScriptedState {
  return {
    messages: [...state.messages, { role: 'user', content }],
    steps: state.steps,
  };
}

export function appendScriptedUserLlmMessage(state: ScriptedState, message: LlmMessage): ScriptedState {
  return {
    messages: [
      ...state.messages,
      {
        role: 'user',
        content: llmMessageTextContent(message.content),
        ...(llmMessageHasImages(message.content)
          ? {
              image_paths: message.content
                .filter((part): part is { type: 'image'; path: string } => part.type === 'image')
                .map((part) => part.path),
            }
          : {}),
      },
    ],
    steps: state.steps,
  };
}

export function extractScriptedAssistantText(state: ScriptedState): string | undefined {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (isJsonObject(message) && message.role === 'assistant' && typeof message.content === 'string') {
      return message.content;
    }
  }

  return undefined;
}

export function truncateScriptedStateForContextRetry(
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

export function truncateScriptedHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  let changed = false;
  const nextHistory = history.map((message) => {
    const text = llmMessageTextContent(message.content);
    if (message.role !== 'tool') {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
      };
    }

    if (text.length <= 200) {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
      };
    }

    changed = true;
    return {
      role: message.role,
      content: createLlmMessageContentFromText(
        `${text.slice(0, 120)}...[tool output truncated for context retry]`,
      ),
      ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
      ...(message.toolCalls !== undefined
        ? {
            toolCalls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            })),
          }
        : {}),
    };
  });

  return {
    history: nextHistory,
    changed,
  };
}

export function rebuildScriptedStateAfterCompaction(
  history: LlmMessage[],
  userInput: string,
  retryState: ScriptedState,
): ScriptedState {
  const rebuilt = createScriptedState(history, userInput);
  rebuilt.steps = retryState.steps;

  for (let index = retryState.messages.length - 1; index >= 0; index -= 1) {
    const message = retryState.messages[index];
    if (
      isJsonObject(message) &&
      message.role === 'user' &&
      typeof message.content === 'string' &&
      userMessageContentMatchesInput(message.content, userInput)
    ) {
      rebuilt.messages.push(...retryState.messages.slice(index + 1).map((item) => cloneJsonValue(item)));
      return rebuilt;
    }
  }

  return {
    messages: retryState.messages.map((message) => cloneJsonValue(message)),
    steps: retryState.steps,
  };
}

export function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneJsonValue(value: JsonValue): JsonValue {
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

export async function* streamFromEvents(events: LlmStreamEvent[]): AsyncIterable<LlmStreamEvent> {
  for (const event of events) {
    await Promise.resolve();
    yield event;
  }
}

export async function flushMicrotasks(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

export function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
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



export {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  tmpdir,
  join,
  isOpenAiVisionUnsupportedError,
  AgentRuntime,
  pendingWorkspaceFilesFromInput,
  userMessageContentMatchesInput,
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  createLlmMessageContentFromTextAndImages,
  createToolExecutionTextOutput,
  llmMessageHasImages,
  llmMessageImagePaths,
  llmMessageTextContent,
};
export type {
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  RuntimeEvent,
  RuntimeTurnResult,
};

export type RuntimeParityCaseResult = Record<string, unknown>;
