import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  RunSubagentRequest,
  AuthorizationDecision,
  AssistantAuxArchiveEntry,
  ChatArchive,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  ToolRequestExecutionMetadata,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from './ports.js';
import {
  STREAM_EVENT_BUDGET_PER_POLL,
  STREAM_STALL_TIMEOUT_MS,
  TOOL_MEMORY_MAX_ENTRIES,
} from './runtime/constants.js';
import {
  cloneHistory,
  createTurnContext,
  defaultToolMemoryFormatter,
  formatPendingMcpResourceContext,
  formatPendingWorkspaceFileContext,
  pendingMcpResourceFromReadResult,
  promptMessagesFromValue,
  pruneToolMemories,
  renderError,
  shortLabelForPendingMcpResource,
  toolNameFromRequest,
} from './runtime/helpers.js';
import { formatUserMessageContentForLlm } from './runtime/user-turn-timestamp.js';
import { prepareSubmittedUserTurn as prepareSubmittedUserTurnInternal } from './runtime/context.js';
import {
  continuePendingManualToolApproval as continuePendingManualToolApprovalInternal,
  startManualToolCommand as startManualToolCommandInternal,
  startManualToolRequest as startManualToolRequestInternal,
  waitForCompletedManualToolCommandResult as waitForCompletedManualToolCommandResultInternal,
  waitForStartedManualToolCommandResult as waitForStartedManualToolCommandResultInternal,
} from './runtime/manual-tools.js';
import {
  executeAuthorizedToolCall as executeAuthorizedToolCallInternal,
  handlePendingToolAgentRoundCompletion as handlePendingToolAgentRoundCompletionInternal,
  pollPendingToolAgentRound as pollPendingToolAgentRoundInternal,
  processToolCalls as processToolCallsInternal,
  processToolCallsAsync as processToolCallsAsyncInternal,
  resumePendingApproval as resumePendingApprovalInternal,
  runTurnLoop as runTurnLoopInternal,
  startToolAgentRoundAsync as startToolAgentRoundAsyncInternal,
  waitForCompletedTurnResult as waitForCompletedTurnResultInternal,
} from './runtime/turn-machine.js';
import {
  pollPendingBackgroundToolExecution as pollPendingBackgroundToolExecutionInternal,
  startBackgroundToolExecutionAsync as startBackgroundToolExecutionAsyncInternal,
  startManualBackgroundToolExecution as startManualBackgroundToolExecutionInternal,
} from './runtime/background-tools.js';
import {
  compactHistoryImmediate as compactHistoryImmediateInternal,
  launchHistoryCompaction as launchHistoryCompactionInternal,
  pollPendingHistoryCompaction as pollPendingHistoryCompactionInternal,
  startHistoryCompactionAsync as startHistoryCompactionAsyncInternal,
  startManualHistoryCompactionAsync as startManualHistoryCompactionAsyncInternal,
  waitForCompletedManualHistoryCompactionResult as waitForCompletedManualHistoryCompactionResultInternal,
} from './runtime/compaction.js';
import {
  clearPendingStreamingState as clearPendingStreamingStateInternal,
  clearStreamingUiState as clearStreamingUiStateInternal,
  consumeStreamEvents as consumeStreamEventsInternal,
  currentAuxKind as currentAuxKindInternal,
  currentAuxText as currentAuxTextInternal,
  handlePendingStreamEvent as handlePendingStreamEventInternal,
  handlePendingStreamingCompletion as handlePendingStreamingCompletionInternal,
  handleStreamStallTimeout as handleStreamStallTimeoutInternal,
  mergeToolProgressIntoThinking as mergeToolProgressIntoThinkingInternal,
  pollPendingStreamingRound as pollPendingStreamingRoundInternal,
  startStreamingRound as startStreamingRoundInternal,
} from './runtime/streaming.js';
import {
  performToolExecution as performToolExecutionInternal,
  persistToolExecutionMemory as persistToolExecutionMemoryInternal,
} from './runtime/tool-execution.js';
import type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingAutoHistoryCompaction,
  PendingAssistantAux,
  PendingApprovalState,
  PendingBackgroundToolExecution,
  PendingHistoryCompaction,
  PendingManualBackgroundToolExecution,
  PendingManualHistoryCompaction,
  PendingMcpResource,
  PendingManualApprovalState,
  PendingStreamingRound,
  PendingToolCallBackgroundToolExecution,
  PendingToolAgentRound,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeManualHistoryCompactionResult,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimePendingApproval,
  RuntimeSubagentSessionArchiveEntry,
  RuntimeSubagentSessionSummary,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from './runtime/types.js';
import type { ContextRuntime } from './runtime/context.js';
import type { ManualToolsRuntime } from './runtime/manual-tools.js';
import type { TurnMachineRuntime } from './runtime/turn-machine.js';
import type { BackgroundToolsRuntime } from './runtime/background-tools.js';
import type { CompactionRuntime } from './runtime/compaction.js';
import type { StreamingRuntime } from './runtime/streaming.js';
import type { ToolExecutionRuntime } from './runtime/tool-execution.js';

export { pendingWorkspaceFilesFromInput, referencedPathsFromInput } from './runtime/helpers.js';
export type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingAssistantAux,
  PendingMcpResource,
  PendingWorkspaceFile,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeHistoryPreparationResult,
  RuntimeManualHistoryCompactionResult,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimePendingApproval,
  RuntimeSubagentSessionArchiveEntry,
  RuntimeSubagentSessionSummary,
  RuntimeStatePreparationResult,
  RuntimeToolExecution,
  RuntimeTurnResult,
} from './runtime/types.js';

interface PendingSubagentExecution<Config, State, ToolRequest, TrustTarget> {
  parentRequest: ToolRequest;
  parentToolCallId: string;
  parentPendingUserInput: string;
  parentState: State;
  parentRemainingCalls: ToolCallRequest[];
  parentTurn: RuntimeTurnContext<ToolRequest>;
  childRuntime: AgentRuntime<Config, State, ToolRequest, TrustTarget>;
  childRecord: RuntimeSubagentSessionArchiveEntry;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

type RunSubagentToolExecutionResult<ToolRequest, TrustTarget> =
  | { kind: 'not-handled' }
  | { kind: 'started' }
  | { kind: 'completed'; text: string; failed: boolean }
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
    };

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
  private childSessionsStore: RuntimeSubagentSessionArchiveEntry[];
  private pendingSubagentExecution:
    | PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>
    | undefined;
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
  private readonly runtimeDepthStore: number;
  private childSessionCounterStore: number;

  constructor(
    options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
    initialHistory: LlmMessage[] = [],
    runtimeDepth = 0,
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
    this.childSessionsStore = [];
    this.streamChunkCounterStore = 0;
    this.thinkingSpinnerIndexStore = 0;
    this.runtimeDepthStore = runtimeDepth;
    this.childSessionCounterStore = 0;
  }

  history(): readonly LlmMessage[] {
    return this.historyStore;
  }

  requestTrace(): readonly JsonValue[] {
    return this.requestTraceStore;
  }

  childSessions(): readonly RuntimeSubagentSessionSummary[] {
    return this.childSessionsStore.map((entry) => ({ ...entry.summary }));
  }

  childSessionArchives(): readonly RuntimeSubagentSessionArchiveEntry[] {
    return this.childSessionsStore.map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      })),
    }));
  }

  childSessionArchive(sessionId: string): RuntimeSubagentSessionArchiveEntry | undefined {
    const entry = this.childSessionsStore.find((candidate) => candidate.summary.sessionId === sessionId);
    if (!entry) {
      return undefined;
    }

    return {
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      })),
    };
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
    return (
      this.pendingApproval !== undefined ||
      this.pendingManualApproval !== undefined ||
      this.pendingSubagentExecution?.childRuntime.hasPendingApproval() === true
    );
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

    if (this.pendingSubagentExecution) {
      const approval = this.pendingSubagentExecution.childRuntime.currentPendingApproval();
      if (approval) {
        return {
          ...approval,
          subagentSessionId: this.pendingSubagentExecution.childRecord.summary.sessionId,
          subagentTitle: this.pendingSubagentExecution.childRecord.summary.title,
        };
      }
    }

    return undefined;
  }

  isBusy(): boolean {
    return (
      this.pendingStreamingRound !== undefined ||
      this.pendingToolAgentRound !== undefined ||
      this.pendingBackgroundToolExecution !== undefined ||
      this.pendingHistoryCompaction !== undefined ||
      this.pendingSubagentExecution !== undefined ||
      this.hasPendingApproval()
    );
  }

  hasPendingManualApproval(): boolean {
    return (
      this.pendingManualApproval !== undefined ||
      this.pendingSubagentExecution?.childRuntime.hasPendingManualApproval() === true
    );
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
    this.pendingSubagentExecution = undefined;
    this.childSessionsStore = [];
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
    this.pendingSubagentExecution = undefined;
    this.childSessionsStore = (archive.subagentSessions ?? []).map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...message.imagePaths],
      })),
    }));
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
      subagentSessions: this.childSessionsStore.map((entry) => ({
        summary: { ...entry.summary },
        llmHistory: entry.llmHistory.map((message) => ({
          role: message.role,
          content: message.content,
          imagePaths: [...message.imagePaths],
        })),
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
    userMessage?: string,
  ): Promise<{
    notice: string;
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>;
  }> {
    const started = await this.prepareMcpPromptTurn(server, prompt, argsJson, userMessage);
    this.startToolAgentRoundAsync(
      started.state,
      started.userTurn,
      createTurnContext<ToolRequest>(),
    );
    const result = await this.waitForCompletedTurnResult();
    return {
      notice: started.notice,
      result,
    };
  }

  async startApplyMcpPrompt(
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<string> {
    const started = await this.prepareMcpPromptTurn(server, prompt, argsJson, userMessage);
    await this.startStreamingRound(
      started.state,
      started.userTurn,
      createTurnContext<ToolRequest>(),
      true,
    );
    return started.notice;
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
    return compactHistoryImmediateInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
    );
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
    await this.pollPendingSubagentExecution();
  }

  handleStreamStallTimeout(
    nowMs = Date.now(),
    stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
  ): void {
    handleStreamStallTimeoutInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      nowMs,
      stallTimeoutMs,
    );
  }

  async resumePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return resumePendingApprovalInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      decision,
    );
  }

  async continuePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<void> {
    const pending = this.pendingApproval;
    if (!pending) {
      if (this.pendingSubagentExecution) {
        await this.continuePendingSubagentApproval(decision);
        return;
      }
      throw new Error('当前没有待确认的工具调用。');
    }

    this.pendingApproval = undefined;
    this.completedTurnResultStore = undefined;

    if (decision.kind === 'allow') {
      if (decision.persistTrust && pending.trustTarget !== undefined) {
        await this.options.toolExecutor.trust(pending.trustTarget);
      }

      if (this.options.toolExecutor.shouldExecuteInBackground?.(pending.request) ?? false) {
        this.startBackgroundToolExecutionAsync(
          pending.pendingUserInput,
          pending.state,
          pending.request,
          pending.toolCallId,
          pending.toolName,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      const execution = await this.performToolExecution(pending.request, pending.toolName);
      pending.turn.toolExecutions.push({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        request: pending.request,
        output: execution.output,
        failed: execution.failed,
      });

      const resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        execution.output,
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
      return;
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
        return;
      }

      const guidanceForLlm = formatUserMessageContentForLlm(guidanceMessage);
      this.historyStore.push({
        role: 'user',
        content: guidanceForLlm,
        imagePaths: [],
      });
      this.pendingUserTurnStore = guidanceMessage;
      resumedState = this.options.appendUserMessage
        ? this.options.appendUserMessage(resumedState, guidanceForLlm)
        : this.options.createToolAgentState(this.historyStore, guidanceMessage);

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedState,
          guidanceMessage,
          pending.turn,
          true,
        );
        return;
      }

      this.startToolAgentRoundAsync(resumedState, guidanceMessage, pending.turn);
      return;
    }

    const deniedText = decision.resultText?.trim()
      ? decision.resultText
      : '[denied by user] tool call rejected by user approval policy';
    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      deniedText,
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

  async executeManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    const result = await this.startManualToolCommand(message);
    return this.waitForStartedManualToolCommandResult(result);
  }

  async startManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
    return startManualToolCommandInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      message,
    );
  }

  async startManualToolRequestDirect(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
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
    return continuePendingManualToolApprovalInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      decision,
    );
  }

  private async runTurnLoop(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return runTurnLoopInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      turn,
    );
  }

  private async processToolCalls(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return processToolCallsInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      calls,
      turn,
    );
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
    return executeAuthorizedToolCallInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      remainingCalls,
      turn,
    );
  }

  private async maybeExecuteInternalToolCall(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    _toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined> {
    const outcome = await this.tryExecuteRunSubagentTool(
      request,
      toolCallId,
      pendingUserInput,
      state,
      remainingCalls,
      turn,
    );
    if (outcome.kind === 'not-handled') {
      return undefined;
    }

    if (outcome.kind === 'requires-approval') {
      const approval = this.currentPendingApproval() ?? outcome.approval;
      return {
        kind: 'requires-approval',
        approval,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    if (outcome.kind === 'started') {
      throw new Error('run_subagent 非流式路径不应返回后台启动状态。');
    }

    const parentToolResultText = buildParentSubagentToolResultTextFromRequest(
      request,
      'subagent',
      outcome.failed,
    );

    turn.toolExecutions.push({
      toolCallId,
      toolName: 'run_subagent',
      request,
      output: outcome.text,
      failed: outcome.failed,
    });

    const resumedState = this.options.appendToolResultMessage(
      state,
      toolCallId,
      parentToolResultText,
    );
    if (remainingCalls.length > 0) {
      return this.processToolCalls(
        resumedState,
        pendingUserInput,
        remainingCalls,
        turn,
      );
    }

    return this.runTurnLoop(resumedState, pendingUserInput, turn);
  }

  private async maybeContinueInternalToolCallAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    _toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<boolean> {
    const outcome = await this.tryExecuteRunSubagentTool(
      request,
      toolCallId,
      pendingUserInput,
      state,
      remainingCalls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
    if (outcome.kind === 'not-handled') {
      return false;
    }

    if (outcome.kind === 'requires-approval') {
      const approval = this.currentPendingApproval() ?? outcome.approval;
      this.emitEvent({
        kind: 'approval-requested',
        approval,
      });
      return true;
    }

    if (outcome.kind === 'started') {
      return true;
    }

    const parentToolResultText = buildParentSubagentToolResultTextFromRequest(
      request,
      'subagent',
      outcome.failed,
    );

    turn.toolExecutions.push({
      toolCallId,
      toolName: 'run_subagent',
      request,
      output: outcome.text,
      failed: outcome.failed,
    });

    const resumedState = this.options.appendToolResultMessage(
      state,
      toolCallId,
      parentToolResultText,
    );
    if (remainingCalls.length > 0) {
      await this.processToolCallsAsync(
        resumedState,
        pendingUserInput,
        remainingCalls,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      );
      return true;
    }

    if (resumeAsStreaming) {
      await this.startStreamingRound(
        resumedState,
        pendingUserInput,
        turn,
        streamingEmitBeginResponse,
      );
      return true;
    }

    this.startToolAgentRoundAsync(resumedState, pendingUserInput, turn);
    return true;
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
    startToolAgentRoundAsyncInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      turn,
      emptyAssistantRetries,
    );
  }

  private async pollPendingToolAgentRound(): Promise<void> {
    return pollPendingToolAgentRoundInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async handlePendingToolAgentRoundCompletion(
    pending: PendingToolAgentRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    return handlePendingToolAgentRoundCompletionInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      pending,
      completion,
    );
  }

  private async processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<void> {
    return processToolCallsAsyncInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      calls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
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
    startBackgroundToolExecutionAsyncInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      pendingUserInput,
      state,
      request,
      toolCallId,
      toolName,
      remainingCalls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
  }

  private startManualBackgroundToolExecution(request: ToolRequest, toolName: string): string | undefined {
    return startManualBackgroundToolExecutionInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      request,
      toolName,
    );
  }

  private async pollPendingBackgroundToolExecution(): Promise<void> {
    return pollPendingBackgroundToolExecutionInternal(
      this as unknown as BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
    );
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
    startHistoryCompactionAsyncInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
      retryState,
      pendingUserInput,
      turn,
      originalError,
      toolTruncationApplied,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
  }

  private startManualHistoryCompactionAsync(): void {
    startManualHistoryCompactionAsyncInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private launchHistoryCompaction(
    pending: PendingHistoryCompaction<State, ToolRequest>,
    history: LlmMessage[],
  ): void {
    launchHistoryCompactionInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
      pending,
      history,
    );
  }

  private async pollPendingHistoryCompaction(): Promise<void> {
    return pollPendingHistoryCompactionInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private completeTurn(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void {
    this.completedTurnResultStore = result;
    this.emitSyncTurnResultEvents(result);
  }

  private async waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return waitForCompletedTurnResultInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async prepareSubmittedUserTurn(
    userInput: string,
    explicitImages: string[],
  ): Promise<State> {
    return prepareSubmittedUserTurnInternal(
      this as unknown as ContextRuntime<Config, State, ToolRequest, TrustTarget>,
      userInput,
      explicitImages,
    );
  }

  private async prepareMcpPromptTurn(
    server: string,
    prompt: string,
    argsJson?: string,
    userMessage?: string,
  ): Promise<{
    notice: string;
    state: State;
    userTurn: string;
  }> {
    if (this.hasPendingApproval()) {
      throw new Error('请先响应当前待确认的工具调用。');
    }

    if (this.isBusy()) {
      throw new Error('上一条回复仍在处理中，请稍候。');
    }

    const value = await this.options.toolExecutor.getMcpPrompt(server, prompt, argsJson);
    const promptMessages = promptMessagesFromValue(value);
    if (promptMessages.length === 0) {
      throw new Error('MCP prompt 未返回可用 messages');
    }

    this.historyStore.push(...promptMessages);

    const trimmedUserMessage = userMessage?.trim();
    let userTurn: string;
    let state: State;
    if (trimmedUserMessage) {
      userTurn = trimmedUserMessage;
      state = await this.prepareSubmittedUserTurn(userTurn, []);
    } else {
      userTurn =
        [...promptMessages]
          .reverse()
          .find((message) => message.role === 'user' && message.content.trim())?.content ??
        `请根据已应用的 MCP prompt ${prompt} 继续。`;
      this.pendingUserTurnStore = userTurn;
      state = this.options.createToolAgentState(this.historyStore, userTurn);
    }

    this.completedTurnResultStore = undefined;
    return {
      notice: `已应用 MCP prompt: ${server} / ${prompt}（${promptMessages.length} 条消息）`,
      state,
      userTurn,
    };
  }

  private async startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void> {
    return startStreamingRoundInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      turn,
      emitBeginResponse,
    );
  }

  private async consumeStreamEvents(
    pending: PendingStreamingRound<State, ToolRequest>,
    eventStream: AsyncIterable<LlmStreamEvent>,
  ): Promise<void> {
    return consumeStreamEventsInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      pending,
      eventStream,
    );
  }

  private async pollPendingStreamingRound(): Promise<void> {
    return pollPendingStreamingRoundInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async handlePendingStreamEvent(
    pending: PendingStreamingRound<State, ToolRequest>,
    event: LlmStreamEvent,
  ): Promise<boolean> {
    return handlePendingStreamEventInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      pending,
      event,
    );
  }

  private async handlePendingStreamingCompletion(
    pending: PendingStreamingRound<State, ToolRequest>,
    completion: ToolAgentRoundCompletion<State>,
  ): Promise<void> {
    return handlePendingStreamingCompletionInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      pending,
      completion,
    );
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
    mergeToolProgressIntoThinkingInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
      progress,
    );
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
    if (this.pendingSubagentExecution && !this.pendingSubagentExecution.childRuntime.currentPendingApproval()) {
      return 'thinking';
    }

    return currentAuxKindInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private currentAuxText(): string | undefined {
    if (this.pendingSubagentExecution) {
      const childApproval = this.pendingSubagentExecution.childRuntime.currentPendingApproval();
      if (childApproval) {
        return `SubAgent 待确认: ${this.pendingSubagentExecution.childRecord.summary.title} / ${childApproval.toolName}`;
      }

      const pendingAssistant = this.pendingSubagentExecution.childRuntime.pendingAssistantText().trim();
      if (pendingAssistant.length > 0) {
        return truncateTextForSubagentSummary(pendingAssistant, 180);
      }

      const thinking = this.pendingSubagentExecution.childRuntime.thinkingText().trim();
      if (thinking.length > 0) {
        return truncateTextForSubagentSummary(thinking, 180);
      }

      return `SubAgent 运行中: ${this.pendingSubagentExecution.childRecord.summary.title}`;
    }

    return currentAuxTextInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private clearStreamingUiState(): void {
    clearStreamingUiStateInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private clearPendingStreamingState(): void {
    clearPendingStreamingStateInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async startManualToolRequest(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
    return startManualToolRequestInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      request,
      toolName,
    );
  }

  private async waitForStartedManualToolCommandResult(
    result: RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    return waitForStartedManualToolCommandResultInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
      result,
    );
  }

  private async waitForCompletedManualToolCommandResult(): Promise<
    RuntimeCompletedManualToolCommandResult<ToolRequest>
  > {
    return waitForCompletedManualToolCommandResultInternal(
      this as unknown as ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async waitForCompletedManualHistoryCompactionResult(): Promise<RuntimeManualHistoryCompactionResult> {
    return waitForCompletedManualHistoryCompactionResultInternal(
      this as unknown as CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async performToolExecution(
    request: ToolRequest,
    toolName: string,
  ): Promise<{
    output: string;
    failed: boolean;
    backgroundExecution: boolean;
  }> {
    return performToolExecutionInternal(
      this as unknown as ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
      request,
      toolName,
    );
  }

  private persistToolExecutionMemory(request: ToolRequest, output: string): void {
    persistToolExecutionMemoryInternal(
      this as unknown as ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
      request,
      output,
    );
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

  private async tryExecuteRunSubagentTool(
    request: ToolRequest,
    parentToolCallId: string,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<RunSubagentToolExecutionResult<ToolRequest, TrustTarget>> {
    const subagent = extractRunSubagentRequest(request);
    if (!subagent) {
      return { kind: 'not-handled' };
    }

    return this.executeRunSubagentTool(
      subagent,
      parentToolCallId,
      request,
      parentPendingUserInput,
      parentState,
      parentRemainingCalls,
      parentTurn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    );
  }

  private async executeRunSubagentTool(
    request: RunSubagentRequest,
    parentToolCallId: string,
    parentRequest: ToolRequest,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
  ): Promise<RunSubagentToolExecutionResult<ToolRequest, TrustTarget>> {
    if (this.runtimeDepthStore >= 1) {
      return {
        kind: 'completed',
        text: '[subagent blocked] 当前版本仅支持主会话创建一层子会话，不支持继续嵌套。',
        failed: true,
      };
    }

    const sessionId = this.nextChildSessionId();
    const startedAtUnixMs = Date.now();
    const record: RuntimeSubagentSessionArchiveEntry = {
      summary: {
        sessionId,
        parentToolCallId,
        title: truncateTextForSubagentSummary(request.task.trim(), 72) || 'SubAgent',
        status: 'running',
        startedAtUnixMs,
        updatedAtUnixMs: startedAtUnixMs,
      },
      llmHistory: [],
    };
    const childRuntime = this.createChildRuntime(
      record.summary.sessionId,
      record.summary.title,
    );
    this.childSessionsStore.push(record);

    const childUserTurn = buildRunSubagentUserTurn(request);
    record.llmHistory = [{
      role: 'user',
      content: childUserTurn,
      imagePaths: [],
    }];
    record.summary.latestMessage = truncateTextForSubagentSummary(request.task.trim(), 180);

    if (resumeAsStreaming) {
      try {
        await childRuntime.startUserTurn(childUserTurn);
        this.pendingSubagentExecution = {
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRuntime,
          childRecord: record,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        };
        this.refreshChildSessionRecord(record, childRuntime);
        record.summary.status = childRuntime.currentPendingApproval() ? 'blocked' : 'running';
        return { kind: 'started' };
      } catch (error) {
        const failed = `[subagent failed] ${renderError(error)}`;
        record.summary.status = 'failed';
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
        record.summary.error = failed;
        return { kind: 'completed', text: failed, failed: true };
      }
    }

    try {
      const result = await childRuntime.submitUserTurn(childUserTurn);
      this.refreshChildSessionRecord(record, childRuntime);

      if (result.kind === 'completed') {
        record.summary.status = 'completed';
        record.summary.completedAtUnixMs = Date.now();
        record.summary.finalOutput = result.assistantText;
        return { kind: 'completed', text: result.assistantText, failed: false };
      }

      if (result.kind === 'requires-approval') {
        record.summary.status = 'blocked';
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.latestMessage = `等待前台确认: ${result.approval.toolName}`;
        delete record.summary.completedAtUnixMs;
        delete record.summary.finalOutput;
        delete record.summary.error;
        this.pendingSubagentExecution = {
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRuntime,
          childRecord: record,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        };
        return { kind: 'requires-approval', approval: result.approval };
      }

      const failed = `[subagent failed] ${result.error}`;
      record.summary.status = 'failed';
      record.summary.completedAtUnixMs = Date.now();
      record.summary.error = failed;
      return { kind: 'completed', text: failed, failed: true };
    } catch (error) {
      const failed = `[subagent failed] ${renderError(error)}`;
      record.summary.status = 'failed';
      record.summary.updatedAtUnixMs = Date.now();
      record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
      record.summary.error = failed;
      return { kind: 'completed', text: failed, failed: true };
    }
  }

  private refreshChildSessionRecord(
    record: RuntimeSubagentSessionArchiveEntry,
    childRuntime: AgentRuntime<Config, State, ToolRequest, TrustTarget>,
  ): void {
    record.llmHistory = childRuntime.history().map((message) => ({
      role: message.role,
      content: message.content,
      imagePaths: [...(message.imagePaths ?? [])],
    }));
    const pendingAssistant = childRuntime.pendingAssistantText().trim();
    if (pendingAssistant.length > 0) {
      record.llmHistory.push({
        role: 'assistant',
        content: pendingAssistant,
        imagePaths: [],
      });
    }
    record.summary.updatedAtUnixMs = Date.now();

    const latestMessage = pendingAssistant.length > 0
      ? truncateTextForSubagentSummary(pendingAssistant, 180)
      : childRuntime.thinkingText().trim().length > 0
        ? truncateTextForSubagentSummary(childRuntime.thinkingText().trim(), 180)
      : latestAssistantMessage(record.llmHistory);
    if (latestMessage !== undefined) {
      record.summary.latestMessage = latestMessage;
    } else {
      delete record.summary.latestMessage;
    }
  }

  private async continuePendingSubagentApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<void> {
    const pending = this.pendingSubagentExecution;
    if (!pending) {
      throw new Error('当前没有待确认的工具调用。');
    }

    this.completedTurnResultStore = undefined;
    await pending.childRuntime.continuePendingApproval(decision);
    this.refreshChildSessionRecord(pending.childRecord, pending.childRuntime);
    pending.childRecord.summary.status = pending.childRuntime.currentPendingApproval() ? 'blocked' : 'running';
    if (pending.childRuntime.currentPendingApproval()) {
      pending.childRecord.summary.latestMessage = `等待前台确认: ${pending.childRuntime.currentPendingApproval()?.toolName}`;
      return;
    }

    await this.pollPendingSubagentExecution();
  }

  private async pollPendingSubagentExecution(): Promise<void> {
    const pending = this.pendingSubagentExecution;
    if (!pending) {
      return;
    }

    await pending.childRuntime.poll();
    pending.childRuntime.drainEvents();
    this.refreshChildSessionRecord(pending.childRecord, pending.childRuntime);

    const childApproval = pending.childRuntime.currentPendingApproval();
    if (childApproval) {
      pending.childRecord.summary.status = 'blocked';
      pending.childRecord.summary.latestMessage = `等待前台确认: ${childApproval.toolName}`;
      delete pending.childRecord.summary.completedAtUnixMs;
      delete pending.childRecord.summary.finalOutput;
      delete pending.childRecord.summary.error;
      return;
    }

    const result = pending.childRuntime.takeCompletedTurnResult();
    if (!result) {
      if (pending.childRuntime.isBusy()) {
        pending.childRecord.summary.status = 'running';
      }
      return;
    }

    if (result.kind === 'requires-approval') {
      pending.childRecord.summary.status = 'blocked';
      pending.childRecord.summary.latestMessage = `等待前台确认: ${result.approval.toolName}`;
      return;
    }

    this.pendingSubagentExecution = undefined;
    const output = result.kind === 'completed'
      ? { text: result.assistantText, failed: false }
      : { text: `[subagent failed] ${result.error}`, failed: true };
    const parentToolResultText = buildParentSubagentToolResultText(
      pending.childRecord.summary.sessionId,
      pending.childRecord.summary.title,
      output.failed,
    );

    pending.childRecord.summary.status = output.failed ? 'failed' : 'completed';
    pending.childRecord.summary.updatedAtUnixMs = Date.now();
    pending.childRecord.summary.completedAtUnixMs = pending.childRecord.summary.updatedAtUnixMs;
    if (output.failed) {
      pending.childRecord.summary.error = output.text;
      delete pending.childRecord.summary.finalOutput;
    } else {
      pending.childRecord.summary.finalOutput = output.text;
      delete pending.childRecord.summary.error;
    }

    pending.parentTurn.toolExecutions.push({
      toolCallId: pending.parentToolCallId,
      toolName: 'run_subagent',
      request: pending.parentRequest,
      output: output.text,
      failed: output.failed,
    });

    const resumedState = this.options.appendToolResultMessage(
      pending.parentState,
      pending.parentToolCallId,
      parentToolResultText,
    );

    if (pending.parentRemainingCalls.length > 0) {
      await this.processToolCallsAsync(
        resumedState,
        pending.parentPendingUserInput,
        pending.parentRemainingCalls,
        pending.parentTurn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    if (pending.resumeAsStreaming) {
      await this.startStreamingRound(
        resumedState,
        pending.parentPendingUserInput,
        pending.parentTurn,
        pending.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(
      resumedState,
      pending.parentPendingUserInput,
      pending.parentTurn,
    );
  }

  private createChildRuntime(
    subagentSessionId: string,
    subagentTitle: string,
  ): AgentRuntime<Config, State, ToolRequest, TrustTarget> {
    return new AgentRuntime<Config, State, ToolRequest, TrustTarget>(
      {
        ...this.options,
        toolExecutor: createSubagentToolExecutor(
          this.options.toolExecutor,
          subagentSessionId,
          subagentTitle,
        ),
      },
      [],
      this.runtimeDepthStore + 1,
    );
  }

  private nextChildSessionId(): string {
    this.childSessionCounterStore += 1;
    return `subagent-${Date.now()}-${this.childSessionCounterStore}`;
  }
}

function extractRunSubagentRequest<ToolRequest>(request: ToolRequest): RunSubagentRequest | undefined {
  if (!isJsonObject(request) || !('RunSubagent' in request)) {
    return undefined;
  }

  const candidate = request.RunSubagent;
  if (!isJsonObject(candidate)) {
    return undefined;
  }

  const value = isJsonObject(candidate.request) ? candidate.request : candidate;
  const task = readOptionalStringField(value, 'task');
  if (task === undefined) {
    return undefined;
  }

  const successCriteria = readOptionalStringField(value, 'success_criteria', 'successCriteria');
  const contextSummary = readOptionalStringField(value, 'context_summary', 'contextSummary');
  const filesToInspect = readOptionalStringArrayField(value, 'files_to_inspect', 'filesToInspect');
  const expectedOutput = readOptionalStringField(value, 'expected_output', 'expectedOutput');

  return {
    task,
    ...(successCriteria !== undefined ? { successCriteria } : {}),
    ...(contextSummary !== undefined ? { contextSummary } : {}),
    ...(filesToInspect !== undefined ? { filesToInspect } : {}),
    ...(expectedOutput !== undefined ? { expectedOutput } : {}),
  };
}

function buildRunSubagentUserTurn(request: RunSubagentRequest): string {
  const sections = [request.task.trim()];
  if (request.contextSummary?.trim()) {
    sections.push(`Context summary:\n${request.contextSummary.trim()}`);
  }
  if (request.successCriteria?.trim()) {
    sections.push(`Success criteria:\n${request.successCriteria.trim()}`);
  }
  if (request.filesToInspect && request.filesToInspect.length > 0) {
    sections.push(`Suggested files to inspect:\n- ${request.filesToInspect.join('\n- ')}`);
  }
  if (request.expectedOutput?.trim()) {
    sections.push(`Expected output:\n${request.expectedOutput.trim()}`);
  }
  sections.push(
    'You are already inside the delegated child session. Execute the delegated task directly.',
  );
  sections.push(
    'Do not discuss whether subagent sessions, delegation, or system permissions are available. Do not add policy or configuration commentary.',
  );
  sections.push('Return only the requested result.');
  return sections.filter((section) => section.trim().length > 0).join('\n\n');
}

function buildParentSubagentToolResultText(
  sessionId: string,
  title: string,
  failed: boolean,
): string {
  return failed
    ? `[subagent failed] sessionId=${sessionId} title=${title}`
    : `[subagent completed] sessionId=${sessionId} title=${title}`;
}

function buildParentSubagentToolResultTextFromRequest<ToolRequest>(
  request: ToolRequest,
  fallbackSessionId: string,
  failed: boolean,
): string {
  const subagent = extractRunSubagentRequest(request);
  const title = truncateTextForSubagentSummary(subagent?.task?.trim() ?? '', 72) || 'SubAgent';
  return buildParentSubagentToolResultText(fallbackSessionId, title, failed);
}

function createSubagentToolExecutor<ToolRequest, TrustTarget>(
  base: AgentRuntimeOptions<unknown, unknown, ToolRequest, TrustTarget>['toolExecutor'],
  subagentSessionId: string,
  subagentTitle: string,
): AgentRuntimeOptions<unknown, unknown, ToolRequest, TrustTarget>['toolExecutor'] {
  return {
    toolDefinitionsJson: () => filterSubagentToolDefinitions(base.toolDefinitionsJson()),
    parseCommand: (message) => base.parseCommand(message),
    requestFromFunctionCall: (name, argumentsJson) => base.requestFromFunctionCall(name, argumentsJson),
    authorize: (request) => base.authorize(request),
    trust: (target) => base.trust(target),
    execute: (request) => base.execute(request),
    startMcpBackgroundRefresh: () => base.startMcpBackgroundRefresh(),
    mcpStatusSnapshot: () => base.mcpStatusSnapshot(),
    addMcpServer: (name, config) => base.addMcpServer(name, config),
    listMcpServers: () => base.listMcpServers(),
    inspectMcpServer: (name) => base.inspectMcpServer(name),
    listMcpTools: (name) => base.listMcpTools(name),
    listMcpResources: (name) => base.listMcpResources(name),
    readMcpResource: (name, uri) => base.readMcpResource(name, uri),
    listCachedMcpPrompts: (name) => base.listCachedMcpPrompts(name),
    listMcpPrompts: (name) => base.listMcpPrompts(name),
    getMcpPrompt: (name, prompt, argsJson) => base.getMcpPrompt(name, prompt, argsJson),
    ...(base.attachRequestMetadata
      ? {
          attachRequestMetadata: (request: ToolRequest, metadata: ToolRequestExecutionMetadata) =>
            base.attachRequestMetadata!(request, {
              ...metadata,
              subagentSessionId,
              subagentTitle,
            }),
        }
      : {}),
    ...(base.shouldExecuteInBackground
      ? {
          shouldExecuteInBackground: (request: ToolRequest) => base.shouldExecuteInBackground!(request),
        }
      : {}),
    ...(base.backgroundStatusText
      ? {
          backgroundStatusText: (request: ToolRequest) => base.backgroundStatusText!(request),
        }
      : {}),
  };
}

function filterSubagentToolDefinitions(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.filter((entry) => {
    if (!isJsonObject(entry)) {
      return true;
    }

    const fn = entry.function;
    return !isJsonObject(fn) || fn.name !== 'run_subagent';
  });
}

function latestAssistantMessage(history: LlmMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === 'assistant' && message.content.trim().length > 0) {
      return truncateTextForSubagentSummary(message.content.trim(), 180);
    }
  }

  return undefined;
}

function truncateTextForSubagentSummary(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join('')}...`;
}

function readOptionalStringField(
  value: Record<string, JsonValue>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function readOptionalStringArrayField(
  value: Record<string, JsonValue>,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
    );
  }

  return undefined;
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
