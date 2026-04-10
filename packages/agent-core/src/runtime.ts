import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  AuthorizationDecision,
  AssistantAuxArchiveEntry,
  ChatArchive,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  ToolExecutor,
} from './ports.js';

const TOOL_MEMORY_PREFIX = '[TOOL_MEMORY]';
const TOOL_MEMORY_RESULT_MAX_CHARS = 1200;
const TOOL_MEMORY_MAX_ENTRIES = 24;
const PENDING_WORKSPACE_FILE_MAX_CHARS = 24_000;
const STREAM_EVENT_BUDGET_PER_POLL = 128;
const STREAM_STALL_TIMEOUT_MS = 20_000;

export interface RuntimeToolExecution<ToolRequest> {
  toolCallId: string;
  toolName: string;
  request: ToolRequest;
  output: string;
  failed: boolean;
}

export interface RuntimeCompactionRecord {
  droppedMessages: number;
  beforeLength: number;
  afterLength: number;
  summary?: string;
}

export interface RuntimeStatePreparationResult<State> {
  state: State;
  changed: boolean;
}

export interface RuntimeHistoryPreparationResult {
  history: LlmMessage[];
  changed: boolean;
}

export type RuntimeEvent<ToolRequest> =
  | {
      kind: 'begin-assistant-response';
    }
  | {
      kind: 'update-pending-assistant-thinking';
      text: string;
    }
  | {
      kind: 'update-pending-assistant-compaction';
      text: string;
    }
  | {
      kind: 'assistant-chunk';
      text: string;
    }
  | {
      kind: 'replace-pending-assistant';
      text: string;
    }
  | {
      kind: 'assistant-response-completed';
    }
  | {
      kind: 'remove-pending-assistant';
    }
  | {
      kind: 'history-compacted';
      droppedMessages: number;
      summaryPreview?: string;
    }
  | {
      kind: 'approval-requested';
      approval: RuntimePendingApproval<ToolRequest, unknown>;
    }
  | {
      kind: 'vision-fallback-retry';
      droppedImages: number;
      message: string;
    }
  | {
      kind: 'background-tool-status';
      phase: 'started' | 'finished';
      toolName: string;
      request: ToolRequest;
      statusText?: string;
      failed?: boolean;
    };

export interface RuntimePendingApproval<ToolRequest, TrustTarget> {
  prompt: string;
  request: ToolRequest;
  trustTarget?: TrustTarget;
  toolCallId?: string;
  toolName: string;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface PendingWorkspaceFile {
  path: string;
  totalChars: number;
  truncated: boolean;
  attachedAtUnixMs: number;
  content: string;
}

export type AssistantAuxKind = 'thinking' | 'compressing';

export interface PendingAssistantAux {
  kind: AssistantAuxKind;
  statusText: string;
  detailText?: string;
}

export type RuntimeApprovalDecision =
  | { kind: 'allow'; persistTrust?: boolean }
  | { kind: 'deny'; resultText?: string }
  | { kind: 'guidance'; userMessage: string; resultText?: string };

export type RuntimeTurnResult<State, ToolRequest, TrustTarget> =
  | {
      kind: 'completed';
      assistantText: string;
      state: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: 'failed';
      error: string;
      state?: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    };

export interface RuntimeCompletedManualToolCommandResult<ToolRequest> {
  kind: 'completed';
  request: ToolRequest;
  toolName: string;
  output: string;
  failed: boolean;
  backgroundExecution: boolean;
}

export type RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
    }
  | {
      kind: 'denied';
      request: ToolRequest;
      toolName: string;
      message: string;
    }
  | {
      kind: 'submitted-user-turn';
      userMessage: string;
      result: RuntimeTurnResult<State, ToolRequest, TrustTarget>;
    }
  | {
      kind: 'failed';
      error: string;
      request?: ToolRequest;
    };

export type RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
  | {
      kind: 'started-background';
      request: ToolRequest;
      toolName: string;
      statusText?: string;
    }
  | {
      kind: 'started-user-turn';
      userMessage: string;
    }
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
    }
  | {
      kind: 'denied';
      request: ToolRequest;
      toolName: string;
      message: string;
    }
  | {
      kind: 'failed';
      error: string;
      request?: ToolRequest;
    };

export type RuntimeManualHistoryCompactionResult =
  | {
      kind: 'completed';
      result: RuntimeCompactionRecord;
    }
  | {
      kind: 'failed';
      error: string;
    };

export interface AgentRuntimeOptions<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  config: Config;
  llmTransport: LlmTransport<Config, State>;
  toolExecutor: ToolExecutor<ToolRequest, TrustTarget>;
  createToolAgentState: (history: LlmMessage[], userInput: string) => State;
  appendToolResultMessage: (state: State, toolCallId: string, content: string) => State;
  appendUserMessage?: (state: State, content: string) => State;
  extractAssistantText: (state: State) => string | undefined;
  formatToolMemory?: (request: ToolRequest, output: string) => string | undefined;
  isVisionUnsupportedError?: (error: string) => boolean;
  truncateStateForContextRetry?: (state: State) => RuntimeStatePreparationResult<State>;
  truncateHistoryForCompaction?: (
    history: LlmMessage[],
  ) => RuntimeHistoryPreparationResult;
  rebuildRetryStateAfterCompaction?: (
    history: LlmMessage[],
    pendingUserInput: string,
    retryState: State,
  ) => State;
  maxAutoCompactRetries?: number;
  maxToolMemoryEntries?: number;
  onEvent?: (event: RuntimeEvent<ToolRequest>) => void;
  resolveWorkspaceFilesFromInput?: (
    userInput: string,
  ) => Promise<PendingWorkspaceFile[]> | PendingWorkspaceFile[];
}

interface RuntimeTurnContext<ToolRequest> {
  requestTrace: JsonValue[];
  toolExecutions: RuntimeToolExecution<ToolRequest>[];
  compactions: RuntimeCompactionRecord[];
  autoCompactAttempts: number;
}

interface PendingApprovalState<State, ToolRequest, TrustTarget> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
}

interface PendingManualApprovalState<ToolRequest, TrustTarget> {
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolName: string;
}

interface PendingStreamingRound<State, ToolRequest> {
  pendingUserInput: string;
  turn: RuntimeTurnContext<ToolRequest>;
  rawEvents: LlmStreamEvent[];
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  streamEnded: boolean;
  cancel: (() => void) | undefined;
}

interface PendingToolAgentRound<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  turn: RuntimeTurnContext<ToolRequest>;
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  emptyAssistantRetries: number;
}

interface PendingToolCallBackgroundToolExecution<State, ToolRequest> {
  kind: 'tool-call';
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  statusText: string | undefined;
  output: string | undefined;
  failed: boolean | undefined;
}

interface PendingManualBackgroundToolExecution<ToolRequest> {
  kind: 'manual';
  request: ToolRequest;
  toolName: string;
  statusText: string | undefined;
  output: string | undefined;
  failed: boolean | undefined;
}

type PendingBackgroundToolExecution<State, ToolRequest> =
  | PendingToolCallBackgroundToolExecution<State, ToolRequest>
  | PendingManualBackgroundToolExecution<ToolRequest>;

interface PendingAutoHistoryCompaction<State, ToolRequest> {
  kind: 'auto-retry';
  pendingUserInput: string;
  retryState: State;
  turn: RuntimeTurnContext<ToolRequest>;
  originalError: string;
  toolTruncationApplied: boolean;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

interface PendingManualHistoryCompaction {
  kind: 'manual';
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

type PendingHistoryCompaction<State, ToolRequest> =
  | PendingAutoHistoryCompaction<State, ToolRequest>
  | PendingManualHistoryCompaction;

export class AgentRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  private readonly options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  private historyStore: LlmMessage[];
  private requestTraceStore: JsonValue[];
  private eventQueueStore: RuntimeEvent<ToolRequest>[];
  private pendingBackgroundToolStatusStore: string | undefined;
  private pendingImagePathsStore: string[];
  private pendingMcpResourcesStore: PendingMcpResource[];
  private pendingAssistantTextStore: string;
  private thinkingTextStore: string;
  private compactionTextStore: string;
  private pendingUserTurnStore: string | undefined;
  private pendingApproval: PendingApprovalState<State, ToolRequest, TrustTarget> | undefined;
  private pendingManualApproval:
    | PendingManualApprovalState<ToolRequest, TrustTarget>
    | undefined;
  private pendingStreamingRound: PendingStreamingRound<State, ToolRequest> | undefined;
  private pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  private pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  private pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  private completedTurnResultStore:
    | RuntimeTurnResult<State, ToolRequest, TrustTarget>
    | undefined;
  private completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  private completedManualHistoryCompactionResultStore:
    | RuntimeManualHistoryCompactionResult
    | undefined;
  private pendingStartedAtStore: number | undefined;
  private pendingLastEventAtStore: number | undefined;
  private streamChunkCounterStore: number;
  private thinkingSpinnerIndexStore: number;

  constructor(
    options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
    initialHistory: LlmMessage[] = [],
  ) {
    this.options = options;
    this.historyStore = cloneHistory(initialHistory);
    this.requestTraceStore = [];
    this.eventQueueStore = [];
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingAssistantTextStore = '';
    this.thinkingTextStore = '';
    this.compactionTextStore = '';
    this.streamChunkCounterStore = 0;
    this.thinkingSpinnerIndexStore = 0;
  }

  history(): readonly LlmMessage[] {
    return this.historyStore;
  }

  requestTrace(): readonly JsonValue[] {
    return this.requestTraceStore;
  }

  drainEvents(): RuntimeEvent<ToolRequest>[] {
    const events = [...this.eventQueueStore];
    this.eventQueueStore = [];
    return events;
  }

  takeCompletedTurnResult(): RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined {
    const result = this.completedTurnResultStore;
    this.completedTurnResultStore = undefined;
    return result;
  }

  takeCompletedManualToolCommandResult():
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined {
    const result = this.completedManualToolCommandResultStore;
    this.completedManualToolCommandResultStore = undefined;
    return result;
  }

  takeCompletedManualHistoryCompactionResult(): RuntimeManualHistoryCompactionResult | undefined {
    const result = this.completedManualHistoryCompactionResultStore;
    this.completedManualHistoryCompactionResultStore = undefined;
    return result;
  }

  pendingUserTurn(): string | undefined {
    return this.pendingUserTurnStore;
  }

  pendingAssistantText(): string {
    return this.pendingAssistantTextStore;
  }

  thinkingText(): string {
    return this.thinkingTextStore;
  }

  compactionText(): string {
    return this.compactionTextStore;
  }

  pendingStartedAt(): number | undefined {
    return this.pendingStartedAtStore;
  }

  pendingLastEventAt(): number | undefined {
    return this.pendingLastEventAtStore;
  }

  streamChunkCounter(): number {
    return this.streamChunkCounterStore;
  }

  backgroundToolStatus(): string | undefined {
    return this.pendingBackgroundToolStatusStore;
  }

  pendingImagePaths(): readonly string[] {
    return this.pendingImagePathsStore;
  }

  pendingMcpResources(): readonly PendingMcpResource[] {
    return this.pendingMcpResourcesStore;
  }

  pendingAuxState(): PendingAssistantAux | undefined {
    const kind = this.currentAuxKind();
    if (!kind) {
      return undefined;
    }

    const frame = ['|', '/', '-', '\\'][this.thinkingSpinnerIndexStore % 4] ?? '|';
    const detailText = this.currentAuxText();
    return {
      kind,
      statusText: kind === 'thinking' ? `${frame} Thinking...` : `${frame} Compressing...`,
      ...(detailText !== undefined ? { detailText } : {}),
    };
  }

  tickThinkingSpinner(): void {
    if (this.isBusy()) {
      this.thinkingSpinnerIndexStore = (this.thinkingSpinnerIndexStore + 1) % 4;
      return;
    }

    this.thinkingSpinnerIndexStore = 0;
  }

  hasPendingApproval(): boolean {
    return this.pendingApproval !== undefined || this.pendingManualApproval !== undefined;
  }

  currentPendingApproval(): RuntimePendingApproval<ToolRequest, TrustTarget> | undefined {
    if (this.pendingApproval) {
      return {
        prompt: this.pendingApproval.prompt,
        request: this.pendingApproval.request,
        ...(this.pendingApproval.trustTarget !== undefined
          ? { trustTarget: this.pendingApproval.trustTarget }
          : {}),
        toolCallId: this.pendingApproval.toolCallId,
        toolName: this.pendingApproval.toolName,
      };
    }

    if (this.pendingManualApproval) {
      return {
        prompt: this.pendingManualApproval.prompt,
        request: this.pendingManualApproval.request,
        ...(this.pendingManualApproval.trustTarget !== undefined
          ? { trustTarget: this.pendingManualApproval.trustTarget }
          : {}),
        toolName: this.pendingManualApproval.toolName,
      };
    }

    return undefined;
  }

  isBusy(): boolean {
    return (
      this.pendingStreamingRound !== undefined ||
      this.pendingToolAgentRound !== undefined ||
      this.pendingBackgroundToolExecution !== undefined ||
      this.pendingHistoryCompaction !== undefined ||
      this.hasPendingApproval()
    );
  }

  hasPendingManualApproval(): boolean {
    return this.pendingManualApproval !== undefined;
  }

  replaceHistory(history: LlmMessage[]): void {
    this.historyStore = cloneHistory(history);
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
  }

  replaceFromArchive(archive: ChatArchive): void {
    this.historyStore = archive.llmHistory.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: message.content,
      imagePaths: [...message.imagePaths],
    }));
    this.requestTraceStore = [];
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
  }

  toArchive(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    assistantAux: AssistantAuxArchiveEntry[],
  ): ChatArchive {
    return {
      messages,
      assistantAux,
      llmHistory: this.historyStore.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      })),
    };
  }

  addPendingImage(path: string): void {
    this.pendingImagePathsStore.push(path);
  }

  clearPendingImages(): number {
    const cleared = this.pendingImagePathsStore.length;
    this.pendingImagePathsStore = [];
    return cleared;
  }

  async attachMcpResource(server: string, uri: string): Promise<string> {
    const value = await this.options.toolExecutor.readMcpResource(server, uri);
    const resource = pendingMcpResourceFromReadResult(server, server, uri, value);
    this.pendingMcpResourcesStore.push(resource);
    return shortLabelForPendingMcpResource(resource);
  }

  clearPendingMcpResources(): number {
    const cleared = this.pendingMcpResourcesStore.length;
    this.pendingMcpResourcesStore = [];
    return cleared;
  }

  recordContextMessage(role: 'system' | 'user' | 'assistant', content: string): void {
    this.historyStore.push({
      role,
      content,
      imagePaths: [],
    });
  }

  async applyMcpPrompt(
    server: string,
    prompt: string,
    argsJson?: string,
  ): Promise<{
    notice: string;
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>;
  }> {
    if (this.hasPendingApproval()) {
      throw new Error('请先响应当前待确认的工具调用。');
    }

    const value = await this.options.toolExecutor.getMcpPrompt(server, prompt, argsJson);
    const promptMessages = promptMessagesFromValue(value);
    if (promptMessages.length === 0) {
      throw new Error('MCP prompt 未返回可用 messages');
    }

    const userTurn =
      [...promptMessages]
        .reverse()
        .find((message) => message.role === 'user' && message.content.trim())?.content ??
      `请根据已应用的 MCP prompt ${prompt} 继续。`;

    this.historyStore.push(...promptMessages);
    this.pendingUserTurnStore = userTurn;
    this.completedTurnResultStore = undefined;
    this.startToolAgentRoundAsync(
      this.options.createToolAgentState(this.historyStore, userTurn),
      userTurn,
      createTurnContext<ToolRequest>(),
    );
    const result = await this.waitForCompletedTurnResult();
    return {
      notice: `已应用 MCP prompt: ${server} / ${prompt}（${promptMessages.length} 条消息）`,
      result,
    };
  }

  async compactHistory(): Promise<RuntimeCompactionRecord> {
    await this.startManualHistoryCompaction();
    const result = await this.waitForCompletedManualHistoryCompactionResult();
    if (result.kind === 'failed') {
      throw new Error(result.error);
    }

    return result.result;
  }

  async startManualHistoryCompaction(): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有压缩任务在后台进行，请稍候。');
    }

    this.completedManualHistoryCompactionResultStore = undefined;
    this.thinkingSpinnerIndexStore = 0;
    this.emitEvent({ kind: 'begin-assistant-response' });
    this.startManualHistoryCompactionAsync();
  }

  private async compactHistoryImmediate(): Promise<RuntimeCompactionRecord> {
    if (this.options.truncateHistoryForCompaction) {
      const prepared = this.options.truncateHistoryForCompaction(this.historyStore);
      this.historyStore = cloneHistory(prepared.history);
    }

    const result = await this.options.llmTransport.compactHistoryManual(
      this.options.config,
      this.historyStore,
    );
    const summary = this.options.llmTransport.compactSummaryText(this.historyStore);
    return {
      droppedMessages: result.droppedMessages,
      beforeLength: result.beforeLength,
      afterLength: result.afterLength,
      ...(summary !== undefined ? { summary } : {}),
    };
  }

  async submitUserTurn(
    userInput: string,
    explicitImages: string[] = [],
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    await this.startUserTurn(userInput, explicitImages);
    return this.waitForCompletedTurnResult();
  }

  async startUserTurn(
    userInput: string,
    explicitImages: string[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    this.completedTurnResultStore = undefined;
    const state = await this.prepareSubmittedUserTurn(userInput, explicitImages);
    this.startToolAgentRoundAsync(state, userInput, createTurnContext<ToolRequest>());
  }

  async startUserTurnStreaming(
    userInput: string,
    explicitImages: string[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    this.completedTurnResultStore = undefined;
    const state = await this.prepareSubmittedUserTurn(userInput, explicitImages);
    await this.startStreamingRound(
      state,
      userInput,
      createTurnContext<ToolRequest>(),
      true,
    );
  }

  async poll(): Promise<void> {
    await this.pollPendingStreamingRound();
    await this.pollPendingToolAgentRound();
    await this.pollPendingHistoryCompaction();
    await this.pollPendingBackgroundToolExecution();
  }

  handleStreamStallTimeout(
    nowMs = Date.now(),
    stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
  ): void {
    const pending = this.pendingStreamingRound;
    if (!pending) {
      return;
    }

    if (!pending.completionHandled) {
      return;
    }

    const lastEventAt = this.pendingLastEventAtStore;
    if (lastEventAt === undefined || nowMs - lastEventAt < stallTimeoutMs) {
      return;
    }

    if (!this.pendingAssistantTextStore.trim()) {
      this.emitEvent({
        kind: 'replace-pending-assistant',
        text: '流式响应超时，连接已中断。',
      });
    } else {
      const suffix = '\n\n[stream timeout] 响应长时间无数据，已自动停止等待。';
      this.pendingAssistantTextStore += suffix;
      this.emitEvent({
        kind: 'assistant-chunk',
        text: suffix,
      });
    }

    this.clearPendingStreamingState();
    this.emitEvent({ kind: 'assistant-response-completed' });
  }

  async resumePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    const pending = this.pendingApproval;
    if (!pending) {
      throw new Error('当前没有待确认的工具调用。');
    }

    this.pendingApproval = undefined;

    if (decision.kind === 'allow') {
      if (decision.persistTrust && pending.trustTarget !== undefined) {
        await this.options.toolExecutor.trust(pending.trustTarget);
      }

      return this.executeAuthorizedToolCall(
        pending.pendingUserInput,
        pending.state,
        pending.request,
        pending.toolCallId,
        pending.toolName,
        pending.remainingCalls,
        pending.turn,
      );
    }

    if (decision.kind === 'guidance') {
      const guidanceText = decision.resultText?.trim()
        ? decision.resultText
        : '[denied by user] tool call rejected by user guidance';
      const guidanceMessage = decision.userMessage.trim();
      let resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        guidanceText,
      );

      if (!guidanceMessage) {
        return this.runTurnLoop(resumedState, pending.pendingUserInput, pending.turn);
      }

      this.historyStore.push({
        role: 'user',
        content: guidanceMessage,
        imagePaths: [],
      });
      this.pendingUserTurnStore = guidanceMessage;
      resumedState = this.options.appendUserMessage
        ? this.options.appendUserMessage(resumedState, guidanceMessage)
        : this.options.createToolAgentState(this.historyStore, guidanceMessage);

      return this.runTurnLoop(resumedState, guidanceMessage, pending.turn);
    }

    const deniedText = decision.resultText?.trim()
      ? decision.resultText
      : '[denied by user] tool call rejected by user approval policy';
    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      deniedText,
    );

    return this.processToolCalls(
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  async executeManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    const result = await this.startManualToolCommand(message);
    return this.waitForStartedManualToolCommandResult(result);
  }

  async startManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    this.completedManualToolCommandResultStore = undefined;
    let request: ToolRequest;
    try {
      request = await this.options.toolExecutor.parseCommand(message);
    } catch (error) {
      return {
        kind: 'failed',
        error: `工具命令解析失败: ${renderError(error)}`,
      };
    }

    const toolName = toolNameFromRequest(request);

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await this.options.toolExecutor.authorize(request);
    } catch (error) {
      return {
        kind: 'failed',
        error: `工具权限检查失败: ${renderError(error)}`,
        request,
      };
    }

    if (authorization.kind === 'need-approval') {
      this.pendingManualApproval = {
        request,
        prompt: authorization.prompt,
        ...(authorization.trustTarget !== undefined
          ? { trustTarget: authorization.trustTarget }
          : {}),
        toolName,
      };
      this.emitEvent({
        kind: 'approval-requested',
        approval: {
          prompt: authorization.prompt,
          request,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolName,
        },
      });
      return {
        kind: 'requires-approval',
        approval: {
          prompt: authorization.prompt,
          request,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolName,
        },
      };
    }

    return this.startManualToolRequest(request, toolName);
  }

  async resumePendingManualToolApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    const result = await this.continuePendingManualToolApproval(decision);
    return this.waitForStartedManualToolCommandResult(result);
  }

  async continuePendingManualToolApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
    const pending = this.pendingManualApproval;
    if (!pending) {
      throw new Error('当前没有待确认的手动工具调用。');
    }

    this.pendingManualApproval = undefined;
    this.completedManualToolCommandResultStore = undefined;

    if (decision.kind === 'allow') {
      if (decision.persistTrust && pending.trustTarget !== undefined) {
        await this.options.toolExecutor.trust(pending.trustTarget);
      }

      return this.startManualToolRequest(pending.request, pending.toolName);
    }

    if (decision.kind === 'guidance') {
      const userMessage = decision.userMessage.trim();
      if (!userMessage) {
        return {
          kind: 'denied',
          request: pending.request,
          toolName: pending.toolName,
          message: '已拒绝本次工具调用。',
        };
      }

      await this.startUserTurn(userMessage);
      return {
        kind: 'started-user-turn',
        userMessage,
      };
    }

    return {
      kind: 'denied',
      request: pending.request,
      toolName: pending.toolName,
      message: '已拒绝本次工具调用。',
    };
  }

  private async runTurnLoop(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    let currentState = state;
    let emptyAssistantRetries = 0;

    while (true) {
      const completion = await this.options.llmTransport.startToolAgentRound(
        this.options.config,
        currentState,
        this.options.toolExecutor.toolDefinitionsJson(),
      );

      if (completion.kind === 'failure') {
        this.appendTrace(completion.requestTrace, turn);

        const textOnlyRetryState = this.tryFallbackToTextOnlyAndBuildRetryState(
          completion.error,
          pendingUserInput,
        );
        if (textOnlyRetryState !== undefined) {
          currentState = textOnlyRetryState;
          continue;
        }

        if (
          this.options.llmTransport.isContextOverflowError(completion.error) &&
          turn.autoCompactAttempts < (this.options.maxAutoCompactRetries ?? 1)
        ) {
          turn.autoCompactAttempts += 1;
          const preparedRetry = this.options.truncateStateForContextRetry
            ? this.options.truncateStateForContextRetry(currentState)
            : { state: currentState, changed: false };
          try {
            const compaction = await this.compactHistoryImmediate();
            turn.compactions.push(compaction);

            if (compaction.droppedMessages === 0 && !preparedRetry.changed) {
              return {
                kind: 'failed',
                error: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${completion.error}`,
                state: preparedRetry.state,
                requestTrace: [...turn.requestTrace],
                toolExecutions: [...turn.toolExecutions],
                compactions: [...turn.compactions],
              };
            }

            currentState =
              compaction.droppedMessages === 0
                ? preparedRetry.state
                : this.options.rebuildRetryStateAfterCompaction
                  ? this.options.rebuildRetryStateAfterCompaction(
                      this.historyStore,
                      pendingUserInput,
                      preparedRetry.state,
                    )
                  : this.options.createToolAgentState(this.historyStore, pendingUserInput);
            continue;
          } catch (error) {
            return {
              kind: 'failed',
              error: `上下文压缩失败: ${renderError(error)} | 原始错误: ${completion.error}`,
              state: currentState,
              requestTrace: [...turn.requestTrace],
              toolExecutions: [...turn.toolExecutions],
              compactions: [...turn.compactions],
            };
          }
        }

        return {
          kind: 'failed',
          error: completion.error,
          state: currentState,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        };
      }

      const round = completion.result;
      this.appendTrace(round.requestTrace, turn);
      currentState = round.state;

      if (round.step.kind === 'tool-calls') {
        return this.processToolCalls(
          currentState,
          pendingUserInput,
          round.step.calls,
          turn,
        );
      }

      const assistantText = this.options.extractAssistantText(currentState)?.trim();
      if (!assistantText) {
        emptyAssistantRetries += 1;
        if (emptyAssistantRetries > 1) {
          return {
            kind: 'failed',
            error: '模型返回了 final-response-ready，但没有可用的 assistant 正文。',
            state: currentState,
            requestTrace: [...turn.requestTrace],
            toolExecutions: [...turn.toolExecutions],
            compactions: [...turn.compactions],
          };
        }
        continue;
      }

      this.historyStore.push({
        role: 'assistant',
        content: assistantText,
        imagePaths: [],
      });
      this.pendingUserTurnStore = undefined;

      return {
        kind: 'completed',
        assistantText,
        state: currentState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }
  }

  private async processToolCalls(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    let currentState = state;
    const remaining = [...calls];

    while (remaining.length > 0) {
      const call = remaining.shift();
      if (!call) {
        break;
      }

      let request: ToolRequest;
      try {
        request = await this.options.toolExecutor.requestFromFunctionCall(
          call.name,
          call.argumentsJson,
        );
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[tool schema error] ${renderError(error)}`,
        );
        continue;
      }

      let authorization: AuthorizationDecision<TrustTarget>;
      try {
        authorization = await this.options.toolExecutor.authorize(request);
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[authorization error] ${renderError(error)}`,
        );
        continue;
      }

      if (authorization.kind === 'need-approval') {
        this.pendingApproval = {
          pendingUserInput,
          state: currentState,
          request,
          prompt: authorization.prompt,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolCallId: call.id,
          toolName: call.name,
          remainingCalls: remaining,
          turn,
        };
        this.emitEvent({
          kind: 'approval-requested',
          approval: {
            prompt: authorization.prompt,
            request,
            ...(authorization.trustTarget !== undefined
              ? { trustTarget: authorization.trustTarget }
              : {}),
            toolCallId: call.id,
            toolName: call.name,
          },
        });

        return {
          kind: 'requires-approval',
          approval: {
            prompt: authorization.prompt,
            request,
            ...(authorization.trustTarget !== undefined
              ? { trustTarget: authorization.trustTarget }
              : {}),
            toolCallId: call.id,
            toolName: call.name,
          },
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        };
      }

      return this.executeAuthorizedToolCall(
        pendingUserInput,
        currentState,
        request,
        call.id,
        call.name,
        remaining,
        turn,
      );
    }

    return this.runTurnLoop(currentState, pendingUserInput, turn);
  }

  private async executeAuthorizedToolCall(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    const execution = await this.performToolExecution(request, toolName);

    turn.toolExecutions.push({
      toolCallId,
      toolName,
      request,
      output: execution.output,
      failed: execution.failed,
    });

    const resumedState = this.options.appendToolResultMessage(state, toolCallId, execution.output);
    if (remainingCalls.length > 0) {
      return this.processToolCalls(resumedState, pendingUserInput, remainingCalls, turn);
    }

    return this.runTurnLoop(resumedState, pendingUserInput, turn);
  }

  private appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void {
    this.requestTraceStore.push(...trace);
    turn.requestTrace.push(...trace);
  }

  private startToolAgentRoundAsync(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emptyAssistantRetries = 0,
  ): void {
    this.clearStreamingUiState();

    const pending: PendingToolAgentRound<State, ToolRequest> = {
      pendingUserInput,
      state,
      turn,
      completion: undefined,
      completionHandled: false,
      emptyAssistantRetries,
    };
    this.pendingToolAgentRound = pending;

    void this.options.llmTransport
      .startToolAgentRound(
        this.options.config,
        state,
        this.options.toolExecutor.toolDefinitionsJson(),
      )
      .then((completion) => {
        if (this.pendingToolAgentRound === pending) {
          pending.completion = completion;
        }
      })
      .catch((error: unknown) => {
        if (this.pendingToolAgentRound === pending) {
          pending.completion = {
            kind: 'failure',
            error: renderError(error),
            requestTrace: [],
          };
        }
      });
  }

  private async pollPendingToolAgentRound(): Promise<void> {
    const pending = this.pendingToolAgentRound;
    if (!pending || pending.completionHandled || !pending.completion) {
      return;
    }

    pending.completionHandled = true;
    this.pendingToolAgentRound = undefined;
    await this.handlePendingToolAgentRoundCompletion(pending, pending.completion);
  }

  private async handlePendingToolAgentRoundCompletion(
    pending: PendingToolAgentRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    if (completion.kind === 'failure') {
      this.appendTrace(completion.requestTrace, pending.turn);

      const textOnlyRetryState = this.tryFallbackToTextOnlyAndBuildRetryState(
        completion.error,
        pending.pendingUserInput,
      );
      if (textOnlyRetryState !== undefined) {
        this.startToolAgentRoundAsync(textOnlyRetryState, pending.pendingUserInput, pending.turn);
        return;
      }

      if (
        this.options.llmTransport.isContextOverflowError(completion.error) &&
        pending.turn.autoCompactAttempts < (this.options.maxAutoCompactRetries ?? 1)
      ) {
        pending.turn.autoCompactAttempts += 1;
        const preparedRetry = this.options.truncateStateForContextRetry
          ? this.options.truncateStateForContextRetry(pending.state)
          : { state: pending.state, changed: false };
        this.startHistoryCompactionAsync(
          preparedRetry.state,
          pending.pendingUserInput,
          pending.turn,
          completion.error,
          preparedRetry.changed,
        );
        return;
      }

      this.completeTurn({
        kind: 'failed',
        error: completion.error,
        state: pending.state,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
      return;
    }

    const round = completion.result;
    this.appendTrace(round.requestTrace, pending.turn);

    if (round.step.kind === 'tool-calls') {
      await this.processToolCallsAsync(
        round.state,
        pending.pendingUserInput,
        round.step.calls,
        pending.turn,
      );
      return;
    }

    const assistantText = this.options.extractAssistantText(round.state)?.trim();
    if (!assistantText) {
      if (pending.emptyAssistantRetries >= 1) {
        this.completeTurn({
          kind: 'failed',
          error: '模型返回了 final-response-ready，但没有可用的 assistant 正文。',
          state: round.state,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        });
        return;
      }

      this.startToolAgentRoundAsync(
        round.state,
        pending.pendingUserInput,
        pending.turn,
        pending.emptyAssistantRetries + 1,
      );
      return;
    }

    this.historyStore.push({
      role: 'assistant',
      content: assistantText,
      imagePaths: [],
    });
    this.pendingUserTurnStore = undefined;
    this.completeTurn({
      kind: 'completed',
      assistantText,
      state: round.state,
      requestTrace: [...pending.turn.requestTrace],
      toolExecutions: [...pending.turn.toolExecutions],
      compactions: [...pending.turn.compactions],
    });
  }

  private async processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<void> {
    let currentState = state;
    const remaining = [...calls];

    while (remaining.length > 0) {
      const call = remaining.shift();
      if (!call) {
        break;
      }

      let request: ToolRequest;
      try {
        request = await this.options.toolExecutor.requestFromFunctionCall(
          call.name,
          call.argumentsJson,
        );
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[tool schema error] ${renderError(error)}`,
        );
        continue;
      }

      let authorization: AuthorizationDecision<TrustTarget>;
      try {
        authorization = await this.options.toolExecutor.authorize(request);
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[authorization error] ${renderError(error)}`,
        );
        continue;
      }

      if (authorization.kind === 'need-approval') {
        this.pendingApproval = {
          pendingUserInput,
          state: currentState,
          request,
          prompt: authorization.prompt,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolCallId: call.id,
          toolName: call.name,
          remainingCalls: remaining,
          turn,
        };

        if (resumeAsStreaming) {
          this.emitEvent({
            kind: 'approval-requested',
            approval: {
              prompt: authorization.prompt,
              request,
              ...(authorization.trustTarget !== undefined
                ? { trustTarget: authorization.trustTarget }
                : {}),
              toolCallId: call.id,
              toolName: call.name,
            },
          });
        } else {
          const result: RuntimeTurnResult<State, ToolRequest, TrustTarget> = {
            kind: 'requires-approval',
            approval: {
              prompt: authorization.prompt,
              request,
              ...(authorization.trustTarget !== undefined
                ? { trustTarget: authorization.trustTarget }
                : {}),
              toolCallId: call.id,
              toolName: call.name,
            },
            requestTrace: [...turn.requestTrace],
            toolExecutions: [...turn.toolExecutions],
            compactions: [...turn.compactions],
          };
          this.completeTurn(result);
        }
        return;
      }

      if (this.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
        this.startBackgroundToolExecutionAsync(
          pendingUserInput,
          currentState,
          request,
          call.id,
          call.name,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        );
        return;
      }

      const execution = await this.performToolExecution(request, call.name);
      turn.toolExecutions.push({
        toolCallId: call.id,
        toolName: call.name,
        request,
        output: execution.output,
        failed: execution.failed,
      });
      currentState = this.options.appendToolResultMessage(currentState, call.id, execution.output);
    }

    if (resumeAsStreaming) {
      await this.startStreamingRound(
        currentState,
        pendingUserInput,
        turn,
        streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(currentState, pendingUserInput, turn);
  }

  private startBackgroundToolExecutionAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): void {
    const statusText = this.options.toolExecutor.backgroundStatusText?.(request);
    this.pendingBackgroundToolStatusStore = statusText;
    this.emitEvent({
      kind: 'background-tool-status',
      phase: 'started',
      toolName,
      request,
      ...(statusText !== undefined ? { statusText } : {}),
    });

    const pending: PendingToolCallBackgroundToolExecution<State, ToolRequest> = {
      kind: 'tool-call',
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      remainingCalls: [...remainingCalls],
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      statusText,
      output: undefined,
      failed: undefined,
    };
    this.pendingBackgroundToolExecution = pending;

    void this.options.toolExecutor
      .execute(request)
      .then((output) => {
        if (this.pendingBackgroundToolExecution === pending) {
          pending.output = output;
          pending.failed = false;
        }
      })
      .catch((error: unknown) => {
        if (this.pendingBackgroundToolExecution === pending) {
          pending.output = `[tool error] ${renderError(error)}`;
          pending.failed = true;
        }
      });
  }

  private startManualBackgroundToolExecution(request: ToolRequest, toolName: string): string | undefined {
    const statusText = this.options.toolExecutor.backgroundStatusText?.(request);
    this.pendingBackgroundToolStatusStore = statusText;
    this.emitEvent({
      kind: 'background-tool-status',
      phase: 'started',
      toolName,
      request,
      ...(statusText !== undefined ? { statusText } : {}),
    });

    const pending: PendingManualBackgroundToolExecution<ToolRequest> = {
      kind: 'manual',
      request,
      toolName,
      statusText,
      output: undefined,
      failed: undefined,
    };
    this.pendingBackgroundToolExecution = pending;

    void this.options.toolExecutor
      .execute(request)
      .then((output) => {
        if (this.pendingBackgroundToolExecution === pending) {
          pending.output = output;
          pending.failed = false;
        }
      })
      .catch((error: unknown) => {
        if (this.pendingBackgroundToolExecution === pending) {
          pending.output = `[tool error] ${renderError(error)}`;
          pending.failed = true;
        }
      });

    return statusText;
  }

  private async pollPendingBackgroundToolExecution(): Promise<void> {
    const pending = this.pendingBackgroundToolExecution;
    if (!pending || pending.output === undefined || pending.failed === undefined) {
      return;
    }

    this.pendingBackgroundToolExecution = undefined;
    this.pendingBackgroundToolStatusStore = undefined;
    this.emitEvent({
      kind: 'background-tool-status',
      phase: 'finished',
      toolName: pending.toolName,
      request: pending.request,
      ...(pending.statusText !== undefined ? { statusText: pending.statusText } : {}),
      failed: pending.failed,
    });

    this.persistToolExecutionMemory(pending.request, pending.output);
    if (pending.kind === 'manual') {
      this.completedManualToolCommandResultStore = {
        kind: 'completed',
        request: pending.request,
        toolName: pending.toolName,
        output: pending.output,
        failed: pending.failed,
        backgroundExecution: true,
      };
      return;
    }

    pending.turn.toolExecutions.push({
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      request: pending.request,
      output: pending.output,
      failed: pending.failed,
    });

    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      pending.output,
    );
    if (pending.remainingCalls.length > 0) {
      await this.processToolCallsAsync(
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    if (pending.resumeAsStreaming) {
      await this.startStreamingRound(
        resumedState,
        pending.pendingUserInput,
        pending.turn,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
  }

  private startHistoryCompactionAsync(
    retryState: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    originalError: string,
    toolTruncationApplied: boolean,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): void {
    if (this.options.truncateHistoryForCompaction) {
      const prepared = this.options.truncateHistoryForCompaction(this.historyStore);
      this.historyStore = cloneHistory(prepared.history);
    }

    this.compactionTextStore = '';
    const history = cloneHistory(this.historyStore);
    const pending: PendingAutoHistoryCompaction<State, ToolRequest> = {
      kind: 'auto-retry',
      pendingUserInput,
      retryState,
      turn,
      originalError,
      toolTruncationApplied,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      compactedHistory: undefined,
      result: undefined,
      failure: undefined,
    };
    this.launchHistoryCompaction(pending, history);
  }

  private startManualHistoryCompactionAsync(): void {
    if (this.options.truncateHistoryForCompaction) {
      const prepared = this.options.truncateHistoryForCompaction(this.historyStore);
      this.historyStore = cloneHistory(prepared.history);
    }

    this.compactionTextStore = '';
    const history = cloneHistory(this.historyStore);
    const pending: PendingManualHistoryCompaction = {
      kind: 'manual',
      compactedHistory: undefined,
      result: undefined,
      failure: undefined,
    };
    this.launchHistoryCompaction(pending, history);
  }

  private launchHistoryCompaction(
    pending: PendingHistoryCompaction<State, ToolRequest>,
    history: LlmMessage[],
  ): void {
    this.pendingHistoryCompaction = pending;

    void this.options.llmTransport
      .compactHistoryManual(this.options.config, history, (chunk) => {
        if (this.pendingHistoryCompaction !== pending || !chunk) {
          return;
        }

        this.compactionTextStore += chunk;
        this.emitEvent({
          kind: 'update-pending-assistant-compaction',
          text: this.compactionTextStore,
        });
      })
      .then((result) => {
        if (this.pendingHistoryCompaction !== pending) {
          return;
        }

        const summary = this.options.llmTransport.compactSummaryText(history);
        pending.compactedHistory = cloneHistory(history);
        pending.result = {
          droppedMessages: result.droppedMessages,
          beforeLength: result.beforeLength,
          afterLength: result.afterLength,
          ...(summary !== undefined ? { summary } : {}),
        };
      })
      .catch((error: unknown) => {
        if (this.pendingHistoryCompaction === pending) {
          pending.failure = renderError(error);
        }
      });
  }

  private async pollPendingHistoryCompaction(): Promise<void> {
    const pending = this.pendingHistoryCompaction;
    if (!pending || (pending.result === undefined && pending.failure === undefined)) {
      return;
    }

    this.pendingHistoryCompaction = undefined;
    if (pending.kind === 'manual') {
      if (pending.failure !== undefined) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: `压缩失败: ${pending.failure}`,
        });
        this.emitEvent({ kind: 'assistant-response-completed' });
        this.compactionTextStore = '';
        this.completedManualHistoryCompactionResultStore = {
          kind: 'failed',
          error: `压缩失败: ${pending.failure}`,
        };
        return;
      }

      const result = pending.result;
      const compactedHistory = pending.compactedHistory;
      if (!result || !compactedHistory) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: '压缩失败: 未产生有效结果',
        });
        this.emitEvent({ kind: 'assistant-response-completed' });
        this.compactionTextStore = '';
        this.completedManualHistoryCompactionResultStore = {
          kind: 'failed',
          error: '压缩失败: 未产生有效结果',
        };
        return;
      }

      this.historyStore = compactedHistory;
      if (!this.compactionTextStore.trim() && result.summary?.trim()) {
        this.compactionTextStore = result.summary;
        this.emitEvent({
          kind: 'update-pending-assistant-compaction',
          text: this.compactionTextStore,
        });
      }

      this.emitEvent({
        kind: 'replace-pending-assistant',
        text:
          result.droppedMessages === 0
            ? '当前可压缩历史较少，已跳过压缩。'
            : `压缩完成：上下文消息 ${result.beforeLength} -> ${result.afterLength}，已合并 ${result.droppedMessages} 条历史消息。`,
      });
      this.emitEvent({ kind: 'assistant-response-completed' });
      this.compactionTextStore = '';
      this.completedManualHistoryCompactionResultStore = {
        kind: 'completed',
        result,
      };
      return;
    }

    if (pending.failure !== undefined) {
      if (pending.resumeAsStreaming) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: `上下文压缩失败: ${pending.failure} | 原始错误: ${pending.originalError}`,
        });
        this.emitEvent({ kind: 'assistant-response-completed' });
      } else {
        this.completeTurn({
          kind: 'failed',
          error: `上下文压缩失败: ${pending.failure} | 原始错误: ${pending.originalError}`,
          state: pending.retryState,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        });
      }
      return;
    }

    const result = pending.result;
    const compactedHistory = pending.compactedHistory;
    if (!result || !compactedHistory) {
      if (pending.resumeAsStreaming) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: `上下文压缩失败: 未产生有效结果 | 原始错误: ${pending.originalError}`,
        });
        this.emitEvent({ kind: 'assistant-response-completed' });
      } else {
        this.completeTurn({
          kind: 'failed',
          error: `上下文压缩失败: 未产生有效结果 | 原始错误: ${pending.originalError}`,
          state: pending.retryState,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        });
      }
      return;
    }

    this.historyStore = compactedHistory;
    pending.turn.compactions.push(result);
    if (!this.compactionTextStore.trim() && result.summary?.trim()) {
      this.compactionTextStore = result.summary;
      this.emitEvent({
        kind: 'update-pending-assistant-compaction',
        text: this.compactionTextStore,
      });
    }

    if (result.droppedMessages === 0 && !pending.toolTruncationApplied) {
      if (pending.resumeAsStreaming) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${pending.originalError}`,
        });
        this.emitEvent({ kind: 'assistant-response-completed' });
      } else {
        this.completeTurn({
          kind: 'failed',
          error: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${pending.originalError}`,
          state: pending.retryState,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        });
      }
      return;
    }

    const nextState =
      result.droppedMessages === 0
        ? pending.retryState
        : this.options.rebuildRetryStateAfterCompaction
          ? this.options.rebuildRetryStateAfterCompaction(
              this.historyStore,
              pending.pendingUserInput,
              pending.retryState,
            )
          : this.options.createToolAgentState(this.historyStore, pending.pendingUserInput);

    if (pending.resumeAsStreaming) {
      await this.startStreamingRound(
        nextState,
        pending.pendingUserInput,
        pending.turn,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(nextState, pending.pendingUserInput, pending.turn);
  }

  private completeTurn(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void {
    this.completedTurnResultStore = result;
    this.emitSyncTurnResultEvents(result);
  }

  private async waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    while (true) {
      const existing = this.takeCompletedTurnResult();
      if (existing) {
        return existing;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出结果时提前进入空闲状态。');
      }

      await this.poll();

      const result = this.takeCompletedTurnResult();
      if (result) {
        return result;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出结果时提前进入空闲状态。');
      }

      await waitForImmediate();
    }
  }

  private async prepareSubmittedUserTurn(
    userInput: string,
    explicitImages: string[],
  ): Promise<State> {
    const images = explicitImages.length > 0 ? [...explicitImages] : this.takePendingImages();
    const workspaceFiles = this.options.resolveWorkspaceFilesFromInput
      ? await this.options.resolveWorkspaceFilesFromInput(userInput)
      : [];
    const resources = this.takePendingMcpResources();
    for (const file of workspaceFiles) {
      this.recordContextMessage('system', formatPendingWorkspaceFileContext(file));
    }
    for (const resource of resources) {
      this.recordContextMessage('system', formatPendingMcpResourceContext(resource));
    }

    this.historyStore.push({
      role: 'user',
      content: userInput,
      imagePaths: images,
    });
    this.pendingUserTurnStore = userInput;
    return this.options.createToolAgentState(this.historyStore, userInput);
  }

  private async startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void> {
    this.clearPendingStreamingState();
    this.pendingStartedAtStore = Date.now();
    this.pendingLastEventAtStore = this.pendingStartedAtStore;

    const pending: PendingStreamingRound<State, ToolRequest> = {
      pendingUserInput,
      turn,
      rawEvents: [],
      completion: undefined,
      completionHandled: false,
      streamEnded: false,
      cancel: undefined,
    };
    this.pendingStreamingRound = pending;

    if (emitBeginResponse) {
      this.emitEvent({ kind: 'begin-assistant-response' });
    }

    const transport = this.options.llmTransport;
    if (transport.startToolAgentRoundStreaming) {
      try {
        const started = await transport.startToolAgentRoundStreaming(
          this.options.config,
          state,
          this.options.toolExecutor.toolDefinitionsJson(),
        );
        if (this.pendingStreamingRound !== pending) {
          started.cancel?.();
          return;
        }

        pending.cancel = started.cancel;
        void this.consumeStreamEvents(pending, started.eventStream);
        void started.completion
          .then((completion) => {
            pending.completion = completion;
          })
          .catch((error: unknown) => {
            pending.completion = {
              kind: 'failure',
              error: renderError(error),
              requestTrace: [],
            };
          });
        return;
      } catch (error) {
        pending.completion = {
          kind: 'failure',
          error: renderError(error),
          requestTrace: [],
        };
        return;
      }
    }

    void this.options.llmTransport
      .startToolAgentRound(
        this.options.config,
        state,
        this.options.toolExecutor.toolDefinitionsJson(),
      )
      .then((completion) => {
        pending.completion = completion;
        if (completion.kind === 'success' && completion.result.step.kind === 'final-response-ready') {
          const assistantText = this.options.extractAssistantText(completion.result.state)?.trim();
          if (assistantText) {
            pending.rawEvents.push({ kind: 'assistant-chunk', text: assistantText });
          }
          pending.rawEvents.push({ kind: 'done' });
        }
      })
      .catch((error: unknown) => {
        pending.completion = {
          kind: 'failure',
          error: renderError(error),
          requestTrace: [],
        };
      });
  }

  private async consumeStreamEvents(
    pending: PendingStreamingRound<State, ToolRequest>,
    eventStream: AsyncIterable<LlmStreamEvent>,
  ): Promise<void> {
    try {
      for await (const event of eventStream) {
        pending.rawEvents.push(event);
      }
    } catch (error) {
      pending.rawEvents.push({
        kind: 'error',
        error: renderError(error),
      });
    }
  }

  private async pollPendingStreamingRound(): Promise<void> {
    const pending = this.pendingStreamingRound;
    if (!pending) {
      return;
    }

    let processed = 0;
    while (processed < STREAM_EVENT_BUDGET_PER_POLL) {
      const event = pending.rawEvents.shift();
      if (!event) {
        break;
      }

      processed += 1;
      const shouldBreak = await this.handlePendingStreamEvent(pending, event);
      if (shouldBreak || this.pendingStreamingRound !== pending) {
        break;
      }
    }

    if (this.pendingStreamingRound !== pending || pending.completionHandled || !pending.completion) {
      return;
    }

    pending.completionHandled = true;
    await this.handlePendingStreamingCompletion(pending, pending.completion);
  }

  private async handlePendingStreamEvent(
    pending: PendingStreamingRound<State, ToolRequest>,
    event: LlmStreamEvent,
  ): Promise<boolean> {
    this.pendingLastEventAtStore = Date.now();

    if (event.kind === 'thinking-chunk') {
      this.thinkingTextStore += event.text;
      this.emitEvent({
        kind: 'update-pending-assistant-thinking',
        text: this.thinkingTextStore,
      });
      return false;
    }

    if (event.kind === 'tool-progress') {
      this.mergeToolProgressIntoThinking(event.text);
      this.emitEvent({
        kind: 'update-pending-assistant-thinking',
        text: this.thinkingTextStore,
      });
      return false;
    }

    if (event.kind === 'assistant-chunk') {
      this.streamChunkCounterStore += 1;
      this.pendingAssistantTextStore += event.text;
      this.emitEvent({
        kind: 'assistant-chunk',
        text: event.text,
      });
      return false;
    }

    if (event.kind === 'history-compacted') {
      this.historyStore = cloneHistory(event.newHistory);
      const summaryPreview = this.options.llmTransport.compactSummaryText(this.historyStore);
      this.emitEvent({
        kind: 'history-compacted',
        droppedMessages: event.droppedMessages,
        ...(summaryPreview !== undefined ? { summaryPreview } : {}),
      });
      return false;
    }

    if (event.kind === 'done') {
      pending.streamEnded = true;
      if (!this.pendingAssistantTextStore.trim()) {
        this.emitEvent({ kind: 'remove-pending-assistant' });
      } else {
        this.historyStore.push({
          role: 'assistant',
          content: this.pendingAssistantTextStore,
          imagePaths: [],
        });
        this.pendingUserTurnStore = undefined;
        this.emitEvent({ kind: 'assistant-response-completed' });
      }

      this.clearStreamingUiState();
      return true;
    }

    const retryState = this.tryFallbackToTextOnlyAndBuildRetryState(
      event.error,
      pending.pendingUserInput,
    );
    if (retryState !== undefined) {
      if (!this.pendingAssistantTextStore.trim()) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: '当前模型不支持图片输入，已自动去除图片并重试。',
        });
      }
      this.emitEvent({ kind: 'assistant-response-completed' });
      await this.startStreamingRound(retryState, pending.pendingUserInput, pending.turn, true);
      return true;
    }

    if (
      this.options.llmTransport.isContextOverflowError(event.error) &&
      pending.turn.autoCompactAttempts < (this.options.maxAutoCompactRetries ?? 1)
    ) {
      pending.turn.autoCompactAttempts += 1;
      const preparedRetry = this.options.truncateStateForContextRetry
        ? this.options.truncateStateForContextRetry(
            this.options.createToolAgentState(this.historyStore, pending.pendingUserInput),
          )
        : {
            state: this.options.createToolAgentState(this.historyStore, pending.pendingUserInput),
            changed: false,
          };

      if (this.pendingAssistantTextStore.trim()) {
        this.emitEvent({ kind: 'replace-pending-assistant', text: '' });
      }
      this.clearPendingStreamingState();
      this.startHistoryCompactionAsync(
        preparedRetry.state,
        pending.pendingUserInput,
        pending.turn,
        event.error,
        preparedRetry.changed,
        true,
        false,
      );
      return true;
    }

    if (!this.pendingAssistantTextStore.trim()) {
      this.emitEvent({
        kind: 'replace-pending-assistant',
        text: `LLM 调用失败: ${event.error}`,
      });
    } else {
      const suffix = `\n\n[Error] ${event.error}`;
      this.pendingAssistantTextStore += suffix;
      this.emitEvent({
        kind: 'assistant-chunk',
        text: suffix,
      });
    }

    this.clearPendingStreamingState();
    this.emitEvent({ kind: 'assistant-response-completed' });
    return true;
  }

  private async handlePendingStreamingCompletion(
    pending: PendingStreamingRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    if (completion.kind === 'failure') {
      this.appendTrace(completion.requestTrace, pending.turn);

      const textOnlyRetryState = this.tryFallbackToTextOnlyAndBuildRetryState(
        completion.error,
        pending.pendingUserInput,
      );
      if (textOnlyRetryState !== undefined) {
        await this.startStreamingRound(
          textOnlyRetryState,
          pending.pendingUserInput,
          pending.turn,
          true,
        );
        return;
      }

      if (
        this.options.llmTransport.isContextOverflowError(completion.error) &&
        pending.turn.autoCompactAttempts < (this.options.maxAutoCompactRetries ?? 1)
      ) {
        pending.turn.autoCompactAttempts += 1;
        const preparedRetry = this.options.truncateStateForContextRetry
          ? this.options.truncateStateForContextRetry(
              this.options.createToolAgentState(this.historyStore, pending.pendingUserInput),
            )
          : {
              state: this.options.createToolAgentState(this.historyStore, pending.pendingUserInput),
              changed: false,
            };

        if (this.pendingAssistantTextStore.trim()) {
          this.emitEvent({ kind: 'replace-pending-assistant', text: '' });
        }
        this.clearPendingStreamingState();
        this.startHistoryCompactionAsync(
          preparedRetry.state,
          pending.pendingUserInput,
          pending.turn,
          completion.error,
          preparedRetry.changed,
          true,
          false,
        );
        return;
      }

      if (!this.pendingAssistantTextStore.trim()) {
        this.emitEvent({
          kind: 'replace-pending-assistant',
          text: `LLM 调用失败: ${completion.error}`,
        });
      }
      this.clearPendingStreamingState();
      this.emitEvent({ kind: 'assistant-response-completed' });
      return;
    }

    const round = completion.result;
    this.appendTrace(round.requestTrace, pending.turn);

    if (round.step.kind === 'tool-calls') {
      if (!pending.streamEnded && !this.pendingAssistantTextStore.trim()) {
        this.emitEvent({ kind: 'remove-pending-assistant' });
      }
      this.clearPendingStreamingState();
      await this.processToolCallsAsync(
        round.state,
        pending.pendingUserInput,
        round.step.calls,
        pending.turn,
        true,
        true,
      );
      return;
    }

    const assistantText = this.options.extractAssistantText(round.state)?.trim();
    if (!assistantText) {
      await this.startStreamingRound(round.state, pending.pendingUserInput, pending.turn, false);
      return;
    }

    if (!pending.streamEnded && !this.pendingAssistantTextStore.trim()) {
      this.pendingAssistantTextStore = assistantText;
      this.emitEvent({ kind: 'assistant-chunk', text: assistantText });
      this.historyStore.push({
        role: 'assistant',
        content: assistantText,
        imagePaths: [],
      });
      this.pendingUserTurnStore = undefined;
      this.clearPendingStreamingState();
      this.emitEvent({ kind: 'assistant-response-completed' });
      return;
    }

    if (pending.streamEnded) {
      this.clearPendingStreamingState();
    }
  }

  private emitSyncTurnResultEvents(
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>,
  ): void {
    if (result.kind === 'completed') {
      this.emitEvent({ kind: 'begin-assistant-response' });
      this.emitEvent({ kind: 'assistant-chunk', text: result.assistantText });
      this.emitEvent({ kind: 'assistant-response-completed' });
      return;
    }

    if (result.kind === 'requires-approval') {
      this.emitEvent({
        kind: 'approval-requested',
        approval: result.approval,
      });
      return;
    }

    this.emitEvent({
      kind: 'replace-pending-assistant',
      text: `LLM 调用失败: ${result.error}`,
    });
    this.emitEvent({ kind: 'assistant-response-completed' });
  }

  private mergeToolProgressIntoThinking(progress: string): void {
    const normalized = progress.trim();
    if (!normalized) {
      return;
    }

    if (!this.thinkingTextStore.trim()) {
      this.thinkingTextStore = normalized;
      return;
    }

    if (this.thinkingTextStore.split('\n').some((line) => line.trim() === normalized)) {
      return;
    }

    if (!this.thinkingTextStore.endsWith('\n')) {
      this.thinkingTextStore += '\n';
    }
    this.thinkingTextStore += normalized;
  }

  private tryFallbackToTextOnlyAndBuildRetryState(
    error: string,
    pendingUserInput: string,
  ): State | undefined {
    if (!this.options.isVisionUnsupportedError?.(error)) {
      return undefined;
    }

    let droppedImages = 0;
    let userTurn = this.pendingUserTurnStore ?? pendingUserInput;

    for (let index = this.historyStore.length - 1; index >= 0; index -= 1) {
      const message = this.historyStore[index];
      if (!message) {
        continue;
      }

      if (message.role !== 'user' || (message.imagePaths?.length ?? 0) === 0) {
        continue;
      }

      droppedImages = message.imagePaths?.length ?? 0;
      if (!userTurn.trim()) {
        userTurn = message.content;
      }
      message.imagePaths = [];
      break;
    }

    if (droppedImages === 0 || !userTurn.trim()) {
      return undefined;
    }

    this.pendingUserTurnStore = userTurn;
    const fallbackMessage = `当前模型/接口不支持图像输入，已自动降级为文本重试（忽略 ${droppedImages} 张图片）。`;
    this.emitEvent({
      kind: 'vision-fallback-retry',
      droppedImages,
      message: fallbackMessage,
    });

    return this.options.createToolAgentState(this.historyStore, userTurn);
  }

  private emitEvent(event: RuntimeEvent<ToolRequest>): void {
    this.eventQueueStore.push(event);
    this.options.onEvent?.(event);
  }

  private clearPendingNonStreamingState(): void {
    this.pendingToolAgentRound = undefined;
    this.pendingBackgroundToolExecution = undefined;
    this.pendingHistoryCompaction = undefined;
    this.completedTurnResultStore = undefined;
    this.completedManualToolCommandResultStore = undefined;
    this.completedManualHistoryCompactionResultStore = undefined;
    this.thinkingSpinnerIndexStore = 0;
  }

  private currentAuxKind(): AssistantAuxKind | undefined {
    if (this.pendingHistoryCompaction) {
      return 'compressing';
    }

    if (
      this.pendingStreamingRound !== undefined ||
      this.pendingToolAgentRound !== undefined ||
      this.pendingBackgroundToolExecution !== undefined
    ) {
      return 'thinking';
    }

    return undefined;
  }

  private currentAuxText(): string | undefined {
    if (this.pendingBackgroundToolStatusStore?.trim()) {
      return this.pendingBackgroundToolStatusStore;
    }

    if (this.pendingHistoryCompaction && this.compactionTextStore.trim()) {
      return this.compactionTextStore;
    }

    if (
      (this.pendingStreamingRound !== undefined ||
        this.pendingToolAgentRound !== undefined ||
        this.pendingBackgroundToolExecution !== undefined) &&
      this.thinkingTextStore.trim()
    ) {
      return this.thinkingTextStore;
    }

    return undefined;
  }

  private clearStreamingUiState(): void {
    this.pendingStartedAtStore = undefined;
    this.pendingLastEventAtStore = undefined;
    this.streamChunkCounterStore = 0;
    this.pendingAssistantTextStore = '';
    this.thinkingTextStore = '';
    this.compactionTextStore = '';
  }

  private clearPendingStreamingState(): void {
    this.pendingStreamingRound?.cancel?.();
    this.pendingStreamingRound = undefined;
    this.clearStreamingUiState();
  }

  private async startManualToolRequest(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
    if (this.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
      const statusText = this.startManualBackgroundToolExecution(request, toolName);
      return {
        kind: 'started-background',
        request,
        toolName,
        ...(statusText !== undefined ? { statusText } : {}),
      };
    }

    const execution = await this.performToolExecution(request, toolName);
    return {
      kind: 'completed',
      request,
      toolName,
      output: execution.output,
      failed: execution.failed,
      backgroundExecution: execution.backgroundExecution,
    };
  }

  private async waitForStartedManualToolCommandResult(
    result: RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    if (result.kind === 'started-background') {
      return this.waitForCompletedManualToolCommandResult();
    }

    if (result.kind === 'started-user-turn') {
      return {
        kind: 'submitted-user-turn',
        userMessage: result.userMessage,
        result: await this.waitForCompletedTurnResult(),
      };
    }

    return result;
  }

  private async waitForCompletedManualToolCommandResult(): Promise<
    RuntimeCompletedManualToolCommandResult<ToolRequest>
  > {
    while (true) {
      const existing = this.takeCompletedManualToolCommandResult();
      if (existing) {
        return existing;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出手动工具结果时提前进入空闲状态。');
      }

      await this.poll();

      const result = this.takeCompletedManualToolCommandResult();
      if (result) {
        return result;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出手动工具结果时提前进入空闲状态。');
      }

      await waitForImmediate();
    }
  }

  private async waitForCompletedManualHistoryCompactionResult(): Promise<RuntimeManualHistoryCompactionResult> {
    while (true) {
      const existing = this.takeCompletedManualHistoryCompactionResult();
      if (existing) {
        return existing;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出手动压缩结果时提前进入空闲状态。');
      }

      await this.poll();

      const result = this.takeCompletedManualHistoryCompactionResult();
      if (result) {
        return result;
      }

      if (!this.isBusy()) {
        throw new Error('runtime 在未产出手动压缩结果时提前进入空闲状态。');
      }

      await waitForImmediate();
    }
  }

  private async performToolExecution(
    request: ToolRequest,
    toolName: string,
  ): Promise<{
    output: string;
    failed: boolean;
    backgroundExecution: boolean;
  }> {
    let output: string;
    let failed = false;
    const backgroundExecution = this.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false;
    const backgroundStatusText = backgroundExecution
      ? this.options.toolExecutor.backgroundStatusText?.(request)
      : undefined;

    if (backgroundExecution) {
      this.pendingBackgroundToolStatusStore = backgroundStatusText;
      this.emitEvent({
        kind: 'background-tool-status',
        phase: 'started',
        toolName,
        request,
        ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
      });
    }

    try {
      output = await this.options.toolExecutor.execute(request);
    } catch (error) {
      failed = true;
      output = `[tool error] ${renderError(error)}`;
    } finally {
      if (backgroundExecution) {
        this.pendingBackgroundToolStatusStore = undefined;
        this.emitEvent({
          kind: 'background-tool-status',
          phase: 'finished',
          toolName,
          request,
          ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
          failed,
        });
      }
    }

    this.persistToolExecutionMemory(request, output);

    return {
      output,
      failed,
      backgroundExecution,
    };
  }

  private persistToolExecutionMemory(request: ToolRequest, output: string): void {
    const toolMemory = (this.options.formatToolMemory ?? defaultToolMemoryFormatter)(
      request,
      output,
    );
    if (toolMemory?.trim()) {
      this.historyStore.push({
        role: 'system',
        content: toolMemory,
        imagePaths: [],
      });
      pruneToolMemories(
        this.historyStore,
        this.options.maxToolMemoryEntries ?? TOOL_MEMORY_MAX_ENTRIES,
      );
    }
  }

  private takePendingImages(): string[] {
    const images = [...this.pendingImagePathsStore];
    this.pendingImagePathsStore = [];
    return images;
  }

  private takePendingMcpResources(): PendingMcpResource[] {
    const resources = [...this.pendingMcpResourcesStore];
    this.pendingMcpResourcesStore = [];
    return resources;
  }
}

function createTurnContext<ToolRequest>(): RuntimeTurnContext<ToolRequest> {
  return {
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
    autoCompactAttempts: 0,
  };
}

function cloneHistory(history: LlmMessage[]): LlmMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
    imagePaths: [...(message.imagePaths ?? [])],
  }));
}

function pruneToolMemories(history: LlmMessage[], maxEntries: number): void {
  let seen = 0;
  const total = history.filter(
    (message) => message.role === 'system' && message.content.startsWith(TOOL_MEMORY_PREFIX),
  ).length;

  if (total <= maxEntries) {
    return;
  }

  const removeCount = total - maxEntries;
  const pruned = history.filter((message) => {
    if (message.role === 'system' && message.content.startsWith(TOOL_MEMORY_PREFIX)) {
      seen += 1;
      return seen > removeCount;
    }

    return true;
  });

  history.splice(0, history.length, ...pruned);
}

function defaultToolMemoryFormatter<ToolRequest>(
  request: ToolRequest,
  output: string,
): string {
  return [
    TOOL_MEMORY_PREFIX,
    `request: ${truncateForPreview(safeStringify(request), 600)}`,
    'result_snippet:',
    truncateForPreview(output, TOOL_MEMORY_RESULT_MAX_CHARS),
  ].join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateForPreview(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function referencedPathsFromInput(input: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of input.split(/\s+/u)) {
    const path = token.startsWith('@') ? token.slice(1) : undefined;
    if (!path) {
      continue;
    }

    const normalized = path.replace(/\\/gu, '/');
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

export async function pendingWorkspaceFilesFromInput(
  workspaceRoot: string,
  text: string,
): Promise<PendingWorkspaceFile[]> {
  const files: PendingWorkspaceFile[] = [];

  for (const path of referencedPathsFromInput(text)) {
    try {
      files.push(await pendingWorkspaceFileFromPath(workspaceRoot, path));
    } catch {
      // 与 Rust 保持一致：忽略不存在、不可读或不支持的引用。
    }
  }

  return files;
}

function formatPendingWorkspaceFileContext(file: PendingWorkspaceFile): string {
  return [
    '[WORKSPACE_FILE]',
    `path: ${file.path}`,
    `attached_at_unix_ms: ${file.attachedAtUnixMs}`,
    `chars: ${file.totalChars}`,
    `truncated: ${file.truncated}`,
    '',
    file.content,
  ].join('\n');
}

async function pendingWorkspaceFileFromPath(
  workspaceRoot: string,
  referencePath: string,
): Promise<PendingWorkspaceFile> {
  const target = join(workspaceRoot, referencePath);
  const metadata = await stat(target);
  if (!metadata.isFile()) {
    throw new Error(`不是可引用的文件: ${target}`);
  }

  const bytes = await readFile(target);
  if (bytes.includes(0)) {
    throw new Error(`暂不支持引用二进制文件: ${referencePath}`);
  }

  const text = bytes.toString('utf8');
  const chars = Array.from(text);
  const truncated = chars.length > PENDING_WORKSPACE_FILE_MAX_CHARS;
  const content = truncated
    ? `${chars.slice(0, PENDING_WORKSPACE_FILE_MAX_CHARS).join('')}\n\n...<文件内容已截断>`
    : text;

  return {
    path: referencePath.replace(/\\/gu, '/'),
    totalChars: chars.length,
    truncated,
    attachedAtUnixMs: Date.now(),
    content,
  };
}

function pendingMcpResourceFromReadResult(
  server: string,
  displayName: string,
  requestedUri: string,
  value: JsonValue,
): PendingMcpResource {
  const contents = isJsonObject(value) && Array.isArray(value.contents) ? value.contents : undefined;
  if (!contents || contents.length === 0) {
    throw new Error(`MCP resource 返回为空: ${requestedUri}`);
  }

  const renderedSections: string[] = [];
  let mimeType: string | undefined;
  let finalUri = requestedUri;

  for (const content of contents) {
    if (!isJsonObject(content)) {
      renderedSections.push(safePrettyJson(content));
      continue;
    }

    if (typeof content.uri === 'string') {
      finalUri = content.uri;
    }
    if (mimeType === undefined && typeof content.mimeType === 'string') {
      mimeType = content.mimeType;
    }

    if (typeof content.text === 'string') {
      renderedSections.push(content.text);
      continue;
    }

    if (typeof content.blob === 'string') {
      renderedSections.push(`[blob base64 omitted, ${Array.from(content.blob).length} chars]`);
      continue;
    }

    renderedSections.push(safePrettyJson(content));
  }

  return {
    server,
    displayName,
    uri: finalUri,
    ...(mimeType !== undefined ? { mimeType } : {}),
    readAtUnixMs: Date.now(),
    content: renderedSections.join('\n\n---\n\n'),
  };
}

function shortLabelForPendingMcpResource(resource: PendingMcpResource): string {
  return `${resource.server} -> ${resource.uri}`;
}

function formatPendingMcpResourceContext(resource: PendingMcpResource): string {
  return [
    '[MCP_RESOURCE]',
    `server: ${resource.server}`,
    `display_name: ${resource.displayName}`,
    `uri: ${resource.uri}`,
    `mime_type: ${resource.mimeType ?? 'application/octet-stream'}`,
    `read_at_unix_ms: ${resource.readAtUnixMs}`,
    '',
    resource.content,
  ].join('\n');
}

function promptMessagesFromValue(value: JsonValue): LlmMessage[] {
  const messages = isJsonObject(value) && Array.isArray(value.messages) ? value.messages : undefined;
  if (!messages) {
    throw new Error('MCP prompt 返回格式异常：缺少 messages');
  }

  return messages.map((message) => {
    if (!isJsonObject(message)) {
      throw new Error('MCP prompt message 格式异常');
    }

    return {
      role: normalizePromptRole(typeof message.role === 'string' ? message.role : 'user'),
      content: promptContentToText(message.content),
      imagePaths: [],
    };
  });
}

function normalizePromptRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant') {
    return 'assistant';
  }
  if (role === 'system') {
    return 'system';
  }
  return 'user';
}

function promptContentToText(content: JsonValue | undefined): string {
  if (typeof content === 'string') {
    return content;
  }

  if (isJsonObject(content) && content.type === 'text') {
    return typeof content.text === 'string' ? content.text : '';
  }

  return safePrettyJson(content);
}

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolNameFromRequest(request: unknown): string {
  if (typeof request === 'object' && request !== null && 'name' in request) {
    const name = (request as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
  }

  return 'manual';
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}