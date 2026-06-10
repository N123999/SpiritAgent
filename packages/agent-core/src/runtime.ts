import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  AskQuestionsResult,
  RunSubagentRequest,
  AuthorizationDecision,
  AssistantAuxArchiveEntry,
  ChatArchive,
  ImageGenerationRequest,
  VideoGenerationRequest,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  ToolExecutionOutput,
  ToolRequestExecutionMetadata,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  StoredLlmMessageArchiveEntry,
} from './ports.js';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  DEFAULT_VIDEO_GENERATION_DURATION,
  cloneLlmProviderState,
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  createToolExecutionTextOutput,
  llmMessageTextContent,
  normalizeStoredLlmMessage,
} from './ports.js';
import {
  STREAM_EVENT_BUDGET_PER_POLL,
  STREAM_STALL_TIMEOUT_MS,
} from './runtime/constants.js';
import {
  cloneHistory,
  createTurnContext,
  enqueueDeferredToolOutputGuidance,
  enqueueDeferredUserGuidance,
  formatPendingMcpResourceContext,
  formatPendingWorkspaceFileContext,
  pendingMcpResourceFromReadResult,
  promptMessagesFromValue,
  renderError,
  isCompatibleContinuedToolRequest,
  repairMissingToolResultsInHistory,
  shortLabelForPendingMcpResource,
  toolArtifactsFromOutput,
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
  commitSyntheticToolExecutionFailure,
  processToolCalls as processToolCallsInternal,
  processToolCallsAsync as processToolCallsAsyncInternal,
  resumePendingApproval as resumePendingApprovalInternal,
  resumePendingQuestions as resumePendingQuestionsInternal,
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
  pollPendingStreamingRound as pollPendingStreamingRoundInternal,
  startStreamingRound as startStreamingRoundInternal,
} from './runtime/streaming.js';
import {
  performToolExecution as performToolExecutionInternal,
  persistToolExecutionResult as persistToolExecutionResultInternal,
} from './runtime/tool-execution.js';
import { buildRuntimeToolExecution } from './runtime/turn-machine.js';
import type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingAutoHistoryCompaction,
  PendingAssistantAux,
  PendingEarlyToolExecution,
  PendingApprovalState,
  PendingBackgroundToolExecution,
  PendingHistoryCompaction,
  PendingQuestionsState,
  PendingManualBackgroundToolExecution,
  PendingManualHistoryCompaction,
  PendingMcpResource,
  PendingWorkspaceFile,
  PendingManualApprovalState,
  PendingStreamingRound,
  PendingToolCallContinuation,
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
  RuntimePendingQuestions,
  RuntimeToolExecution,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from './runtime/types.js';
import type { ContextRuntime } from './runtime/context.js';
import type { ManualToolsRuntime } from './runtime/manual-tools.js';
import type { EarlyInternalToolCallResult, TurnMachineRuntime } from './runtime/turn-machine.js';
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
  RuntimePendingQuestions,
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

interface PendingSubagentBatchContinuation<State, ToolRequest> {
  parentState: State;
  parentPendingUserInput: string;
  parentTurn: RuntimeTurnContext<ToolRequest>;
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
    }
  | {
      kind: 'requires-questions';
      questions: RuntimePendingQuestions<ToolRequest>;
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
  private toolPreviewSeenInStreamRoundStore = false;
  private compactionTextStore: string;
  private pendingUserTurnStore: string | undefined;
  private pendingApproval: PendingApprovalState<State, ToolRequest, TrustTarget> | undefined;
  private pendingQuestions: PendingQuestionsState<State, ToolRequest> | undefined;
  private pendingManualApproval:
    | PendingManualApprovalState<ToolRequest, TrustTarget>
    | undefined;
  private pendingStreamingRound: PendingStreamingRound<State, ToolRequest> | undefined;
  private pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  private pendingToolCallContinuation:
    | PendingToolCallContinuation<State, ToolRequest>
    | undefined;
  private pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  private pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  private childSessionsStore: RuntimeSubagentSessionArchiveEntry[];
  private pendingSubagentExecutions = new Map<
    string,
    PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>
  >();
  private pendingSubagentBatchContinuation:
    | PendingSubagentBatchContinuation<State, ToolRequest>
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
  private loopEnabledStore: boolean;
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
    this.toolPreviewSeenInStreamRoundStore = false;
    this.compactionTextStore = '';
    this.childSessionsStore = [];
    this.streamChunkCounterStore = 0;
    this.thinkingSpinnerIndexStore = 0;
    this.loopEnabledStore = false;
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

  loopEnabled(): boolean {
    return this.loopEnabledStore;
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabledStore = enabled;
    this.options.toolExecutor.setLoopToolExposure?.(enabled);
  }

  childSessionArchives(): readonly RuntimeSubagentSessionArchiveEntry[] {
    return this.childSessionsStore.map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => serializeRuntimeLlmMessageForArchive(message)),
    }));
  }

  childSessionArchive(sessionId: string): RuntimeSubagentSessionArchiveEntry | undefined {
    const entry = this.childSessionsStore.find((candidate) => candidate.summary.sessionId === sessionId);
    if (!entry) {
      return undefined;
    }

    return {
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => serializeRuntimeLlmMessageForArchive(message)),
    };
  }

  drainActiveChildSessionEvents(): Array<{
    sessionId: string;
    parentToolCallId: string;
    events: RuntimeEvent<ToolRequest>[];
  }> {
    const drains: Array<{
      sessionId: string;
      parentToolCallId: string;
      events: RuntimeEvent<ToolRequest>[];
    }> = [];

    for (const pending of this.pendingSubagentExecutions.values()) {
      drains.push({
        sessionId: pending.childRecord.summary.sessionId,
        parentToolCallId: pending.childRecord.summary.parentToolCallId,
        events: pending.childRuntime.drainEvents(),
      });
    }

    return drains;
  }

  childSessionPendingAuxState(sessionId: string): PendingAssistantAux | undefined {
    const pending = this.findPendingSubagentBySessionId(sessionId);
    if (!pending) {
      return undefined;
    }

    return pending.childRuntime.pendingAuxState();
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
    if (this.pendingSubagentExecutions.size > 0) {
      const frame = ['|', '/', '-', '\\'][this.thinkingSpinnerIndexStore % 4] ?? '|';
      return {
        kind: 'thinking',
        statusText: `${frame} ${this.currentSubagentStatusText()}`,
      };
    }

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
      this.findPendingSubagentWithApproval() !== undefined
    );
  }

  hasPendingQuestions(): boolean {
    return (
      this.pendingQuestions !== undefined ||
      this.findPendingSubagentWithQuestions() !== undefined
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

    const pendingSubagent = this.findPendingSubagentWithApproval();
    if (pendingSubagent) {
      const approval = pendingSubagent.childRuntime.currentPendingApproval();
      if (approval) {
        return {
          ...approval,
          subagentSessionId: pendingSubagent.childRecord.summary.sessionId,
          subagentTitle: pendingSubagent.childRecord.summary.title,
        };
      }
    }

    return undefined;
  }

  currentPendingQuestions(): RuntimePendingQuestions<ToolRequest> | undefined {
    if (this.pendingQuestions) {
      return {
        request: this.pendingQuestions.request,
        toolCallId: this.pendingQuestions.toolCallId,
        toolName: this.pendingQuestions.toolName,
        questions: this.pendingQuestions.questions,
      };
    }

    const pendingSubagent = this.findPendingSubagentWithQuestions();
    if (pendingSubagent) {
      return pendingSubagent.childRuntime.currentPendingQuestions();
    }

    return undefined;
  }

  private updateSubagentQuestionsBlockedState(
    record: RuntimeSubagentSessionArchiveEntry,
    questions: RuntimePendingQuestions<ToolRequest>,
  ): void {
    record.summary.status = 'blocked';
    record.summary.updatedAtUnixMs = Date.now();
    record.summary.latestMessage = `等待补充信息: ${questions.toolName}`;
    delete record.summary.completedAtUnixMs;
    delete record.summary.finalOutput;
    delete record.summary.error;
  }

  private cachePendingSubagentExecution(
    pending: PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>,
  ): void {
    this.pendingSubagentExecutions.set(pending.parentToolCallId, pending);
  }

  private findPendingSubagentBySessionId(
    sessionId: string,
  ): PendingSubagentExecution<Config, State, ToolRequest, TrustTarget> | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRecord.summary.sessionId === sessionId) {
        return pending;
      }
    }
    return undefined;
  }

  private findPendingSubagentWithApproval():
    | PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>
    | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRuntime.hasPendingApproval()) {
        return pending;
      }
    }
    return undefined;
  }

  private findPendingSubagentWithQuestions():
    | PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>
    | undefined {
    for (const pending of this.pendingSubagentExecutions.values()) {
      if (pending.childRuntime.hasPendingQuestions()) {
        return pending;
      }
    }
    return undefined;
  }

  private firstPendingSubagentExecution():
    | PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>
    | undefined {
    return this.pendingSubagentExecutions.values().next().value;
  }

  private ensureSubagentBatchContinuation(
    state: State,
    parentPendingUserInput: string,
    parentTurn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming: boolean,
    streamingEmitBeginResponse: boolean,
  ): void {
    if (!this.pendingSubagentBatchContinuation) {
      this.pendingSubagentBatchContinuation = {
        parentState: state,
        parentPendingUserInput,
        parentTurn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      };
    }
  }

  private clearPendingSubagentState(): void {
    for (const pending of this.pendingSubagentExecutions.values()) {
      pending.childRuntime.abort();
    }
    this.pendingSubagentExecutions.clear();
    this.pendingSubagentBatchContinuation = undefined;
  }

  private buildPendingSubagentExecution(
    parentRequest: ToolRequest,
    parentToolCallId: string,
    parentPendingUserInput: string,
    parentState: State,
    parentRemainingCalls: ToolCallRequest[],
    parentTurn: RuntimeTurnContext<ToolRequest>,
    childRuntime: AgentRuntime<Config, State, ToolRequest, TrustTarget>,
    childRecord: RuntimeSubagentSessionArchiveEntry,
    resumeAsStreaming: boolean,
    streamingEmitBeginResponse: boolean,
  ): PendingSubagentExecution<Config, State, ToolRequest, TrustTarget> {
    return {
      parentRequest,
      parentToolCallId,
      parentPendingUserInput,
      parentState,
      parentRemainingCalls,
      parentTurn,
      childRuntime,
      childRecord,
      resumeAsStreaming,
      streamingEmitBeginResponse,
    };
  }

  isBusy(): boolean {
    return (
      this.pendingStreamingRound !== undefined ||
      this.pendingToolAgentRound !== undefined ||
      this.pendingToolCallContinuation !== undefined ||
      this.pendingBackgroundToolExecution !== undefined ||
      this.pendingHistoryCompaction !== undefined ||
      this.pendingSubagentExecutions.size > 0 ||
      this.pendingQuestions !== undefined ||
      this.hasPendingApproval()
    );
  }

  abort(): void {
    if (!this.isBusy()) {
      return;
    }

    const hasPendingAssistantText = this.pendingAssistantTextStore.trim().length > 0;

    if (hasPendingAssistantText) {
      this.historyStore.push({
        role: 'assistant',
        content: createLlmMessageContentFromText(this.pendingAssistantTextStore),
      });
      this.emitEvent({ kind: 'assistant-response-completed' });
    } else {
      this.emitEvent({ kind: 'remove-pending-assistant' });
    }

    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.pendingQuestions = undefined;
    this.clearPendingSubagentState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
  }

  hasPendingManualApproval(): boolean {
    return (
      this.pendingManualApproval !== undefined ||
      [...this.pendingSubagentExecutions.values()].some(
        (pending) => pending.childRuntime.hasPendingManualApproval(),
      )
    );
  }

  replaceHistory(history: LlmMessage[]): void {
    this.historyStore = repairMissingToolResultsInHistory(cloneHistory(history));
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.clearPendingSubagentState();
    this.childSessionsStore = [];
  }

  replaceFromArchive(archive: ChatArchive): void {
    this.historyStore = repairMissingToolResultsInHistory(
      archive.llmHistory.map((message) => normalizeStoredLlmMessage(message)),
    );
    this.loopEnabledStore = archive.loopEnabled === true;
    this.options.toolExecutor.setLoopToolExposure?.(this.loopEnabledStore);
    this.requestTraceStore = [];
    this.clearPendingStreamingState();
    this.clearPendingNonStreamingState();
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
    this.clearPendingSubagentState();
    this.childSessionsStore = (archive.subagentSessions ?? []).map((entry) => ({
      summary: { ...entry.summary },
      llmHistory: entry.llmHistory.map((message) => normalizeStoredLlmMessage(message)),
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
        ...(message.providerState !== undefined
          ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
      })),
      subagentSessions: this.childSessionsStore.map((entry) => ({
        summary: { ...entry.summary },
        llmHistory: entry.llmHistory.map((message) => ({
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
          ...(message.providerState !== undefined
            ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
        })),
      })),
      loopEnabled: this.loopEnabledStore,
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
      content: createLlmMessageContentFromText(content),
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
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    await this.startUserTurn(userInput, explicitImages, explicitWorkspaceFiles);
    return this.waitForCompletedTurnResult();
  }

  async startUserTurn(
    userInput: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    this.completedTurnResultStore = undefined;
    const state = await this.prepareSubmittedUserTurn(userInput, explicitImages, explicitWorkspaceFiles);
    this.startToolAgentRoundAsync(state, userInput, createTurnContext<ToolRequest>());
  }

  async startUserTurnStreaming(
    userInput: string,
    explicitImages: string[] = [],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
  ): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    this.completedTurnResultStore = undefined;
    const state = await this.prepareSubmittedUserTurn(userInput, explicitImages, explicitWorkspaceFiles);
    await this.startStreamingRound(
      state,
      userInput,
      createTurnContext<ToolRequest>(),
      true,
    );
  }

  async continueAssistantCompletionStreaming(): Promise<void> {
    if (this.isBusy()) {
      throw new Error('当前已有响应或审批在处理中，请稍候。');
    }

    const history = cloneHistory(this.historyStore);
    const lastHistoryMessage = [...history].reverse().find((message) => {
      if (message.role === 'tool') {
        return true;
      }
      if (message.role === 'assistant' || message.role === 'user') {
        return llmMessageTextContent(message.content).trim().length > 0;
      }
      return false;
    });
    if (
      !lastHistoryMessage ||
      (lastHistoryMessage.role !== 'assistant' &&
        lastHistoryMessage.role !== 'user' &&
        lastHistoryMessage.role !== 'tool')
    ) {
      throw new Error('当前没有可继续补全的回复。');
    }

    this.completedTurnResultStore = undefined;
    const pendingUserInput =
      [...history]
        .reverse()
        .find((message) => message.role === 'user' && llmMessageTextContent(message.content).trim())
        ?.content;
    const pendingUserText = pendingUserInput ? llmMessageTextContent(pendingUserInput) : '';
    const state = this.options.createContinuationState
      ? this.options.createContinuationState(history)
      : this.options.createToolAgentState(history, '');
    await this.startStreamingRound(
      state,
      pendingUserText,
      createTurnContext<ToolRequest>(),
      true,
    );
  }

  async poll(): Promise<void> {
    await this.pollPendingStreamingRound();
    await this.pollPendingToolCallContinuation();
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

  async resumePendingQuestions(
    result: AskQuestionsResult,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return resumePendingQuestionsInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      result,
    );
  }

  async continuePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<void> {
    const pending = this.pendingApproval;
    if (!pending) {
      if (this.pendingSubagentExecutions.size > 0) {
        await this.continuePendingSubagentApproval(decision);
        return;
      }
      throw new Error('当前没有待确认的工具调用。');
    }

    this.pendingApproval = undefined;
    this.completedTurnResultStore = undefined;
    this.emitEvent({
      kind: 'approval-resolved',
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      request: pending.request,
      decisionKind: decision.kind,
    });

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
          pending.earlyToolExecutions,
        );
        return;
      }

      const execution = await this.performToolExecution(
        pending.request,
        pending.toolName,
        pending.toolCallId,
      );
      const finished = buildRuntimeToolExecution({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        request: pending.request,
        output: execution.output,
        failed: execution.failed,
      });
      pending.turn.toolExecutions.push(finished);
      this.emitEvent({ kind: 'tool-execution-finished', execution: finished });
      enqueueDeferredToolOutputGuidance(pending.turn, pending.toolName, execution.output);

      const resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        execution.output.summaryText,
      );

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedState,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
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
      commitSyntheticToolExecutionFailure(
        this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
        pending.turn,
        pending.request,
        pending.toolCallId,
        pending.toolName,
        guidanceText,
      );
      let resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        guidanceText,
      );

      if (!guidanceMessage) {
        if (pending.remainingCalls.length > 0) {
          this.queuePendingToolCallContinuation(
            resumedState,
            pending.pendingUserInput,
            pending.remainingCalls,
            pending.turn,
            pending.resumeAsStreaming,
            pending.streamingEmitBeginResponse,
            pending.earlyToolExecutions,
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

      enqueueDeferredUserGuidance(pending.turn, guidanceMessage);

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedState,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedState,
          pending.pendingUserInput,
          pending.turn,
          true,
        );
        return;
      }

      this.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
      return;
    }

    const deniedText = decision.resultText?.trim()
      ? decision.resultText
      : '[denied by user] tool call rejected by user approval policy';
    commitSyntheticToolExecutionFailure(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      pending.turn,
      pending.request,
      pending.toolCallId,
      pending.toolName,
      deniedText,
    );
    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      deniedText,
    );

    if (pending.remainingCalls.length > 0) {
      this.queuePendingToolCallContinuation(
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
        pending.earlyToolExecutions,
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

  async continuePendingQuestions(
    result: AskQuestionsResult,
  ): Promise<void> {
    if (!this.pendingQuestions) {
      const pendingSubagent = this.findPendingSubagentWithQuestions();
      if (!pendingSubagent) {
        throw new Error('当前没有待回答的问题表单。');
      }

      this.completedTurnResultStore = undefined;
      await pendingSubagent.childRuntime.continuePendingQuestions(result);
      this.refreshChildSessionRecord(pendingSubagent.childRecord, pendingSubagent.childRuntime);
      const childQuestions = pendingSubagent.childRuntime.currentPendingQuestions();
      if (childQuestions) {
        this.updateSubagentQuestionsBlockedState(pendingSubagent.childRecord, childQuestions);
        return;
      }

      await this.pollPendingSubagentExecution();
      return;
    }

    const pending = this.pendingQuestions;
    this.pendingQuestions = undefined;
    this.completedTurnResultStore = undefined;

    const resumeAfterToolOutput = async (output: string): Promise<void> => {
      const resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        output,
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

      this.startToolAgentRoundAsync(
        resumedState,
        pending.pendingUserInput,
        pending.turn,
      );
    };

    const continuedRequest = this.options.toolExecutor.continueAfterQuestions
      ? await this.options.toolExecutor.continueAfterQuestions(pending.request, result)
      : undefined;

    if (continuedRequest !== undefined) {
      if (!isCompatibleContinuedToolRequest(pending.request, continuedRequest)) {
        await resumeAfterToolOutput(
          '[continueAfterQuestions error] continued request must stay on the same tool.',
        );
        return;
      }

      let authorization: AuthorizationDecision<TrustTarget>;
      try {
        authorization = await this.options.toolExecutor.authorize(continuedRequest);
      } catch (error) {
        await resumeAfterToolOutput(`[authorization error] ${renderError(error)}`);
        return;
      }

      if (authorization.kind === 'need-approval') {
        const approval = {
          prompt: authorization.prompt,
          request: continuedRequest,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
        };
        this.pendingApproval = {
          pendingUserInput: pending.pendingUserInput,
          state: pending.state,
          request: continuedRequest,
          prompt: authorization.prompt,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolCallId: pending.toolCallId,
          toolName: pending.toolName,
          remainingCalls: pending.remainingCalls,
          turn: pending.turn,
          resumeAsStreaming: pending.resumeAsStreaming,
          streamingEmitBeginResponse: pending.streamingEmitBeginResponse,
          ...(pending.earlyToolExecutions ? { earlyToolExecutions: pending.earlyToolExecutions } : {}),
        };
        this.emitEvent({
          kind: 'approval-requested',
          approval,
        });
        return;
      }

      if (authorization.kind === 'need-questions') {
        await resumeAfterToolOutput(
          '[continueAfterQuestions error] continued request cannot require questions again.',
        );
        return;
      }

      const resumedState = pending.state;
      if (this.options.toolExecutor.shouldExecuteInBackground?.(continuedRequest) ?? false) {
        this.startBackgroundToolExecutionAsync(
          pending.pendingUserInput,
          resumedState,
          continuedRequest,
          pending.toolCallId,
          pending.toolName,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      const execution = await this.performToolExecution(
        continuedRequest,
        pending.toolName,
        pending.toolCallId,
      );
      const finished = buildRuntimeToolExecution({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        request: continuedRequest,
        output: execution.output,
        failed: execution.failed,
      });
      pending.turn.toolExecutions.push(finished);
      this.emitEvent({ kind: 'tool-execution-finished', execution: finished });
      enqueueDeferredToolOutputGuidance(pending.turn, pending.toolName, execution.output);

      const resumedStateWithToolOutput = this.options.appendToolResultMessage(
        resumedState,
        pending.toolCallId,
        execution.output.summaryText,
      );

      if (pending.remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          resumedStateWithToolOutput,
          pending.pendingUserInput,
          pending.remainingCalls,
          pending.turn,
          pending.resumeAsStreaming,
          pending.streamingEmitBeginResponse,
          pending.earlyToolExecutions,
        );
        return;
      }

      if (pending.resumeAsStreaming) {
        await this.startStreamingRound(
          resumedStateWithToolOutput,
          pending.pendingUserInput,
          pending.turn,
          pending.streamingEmitBeginResponse,
        );
        return;
      }

      this.startToolAgentRoundAsync(
        resumedStateWithToolOutput,
        pending.pendingUserInput,
        pending.turn,
      );
      return;
    }

    const output = JSON.stringify(result);
    const questionsFinished: RuntimeToolExecution<ToolRequest> = {
      toolCallId: pending.toolCallId,
      toolName: pending.toolName,
      request: pending.request,
      output,
      failed: false,
    };
    pending.turn.toolExecutions.push(questionsFinished);
    this.emitEvent({ kind: 'tool-execution-finished', execution: questionsFinished });

    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      output,
    );

    if (pending.remainingCalls.length > 0) {
      this.queuePendingToolCallContinuation(
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
        pending.resumeAsStreaming,
        pending.streamingEmitBeginResponse,
        pending.earlyToolExecutions,
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
    const finishSummary = extractFinishTaskSummary(request);
    if (finishSummary !== undefined && this.loopEnabled()) {
      return this.completeFinishTaskToolCall(state, request, toolCallId, finishSummary, turn);
    }

    const imageResult = await this.tryExecuteGenerateImageTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (imageResult !== undefined) {
      if (imageResult.kind !== 'completed' || imageResult.assistantText !== '') {
        return imageResult;
      }

      if (remainingCalls.length > 0) {
        return this.processToolCalls(
          imageResult.state,
          pendingUserInput,
          remainingCalls,
          turn,
        );
      }

      return this.runTurnLoop(imageResult.state, pendingUserInput, turn);
    }

    const videoResult = await this.tryExecuteGenerateVideoTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (videoResult !== undefined) {
      if (videoResult.kind !== 'completed' || videoResult.assistantText !== '') {
        return videoResult;
      }

      if (remainingCalls.length > 0) {
        return this.processToolCalls(
          videoResult.state,
          pendingUserInput,
          remainingCalls,
          turn,
        );
      }

      return this.runTurnLoop(videoResult.state, pendingUserInput, turn);
    }

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

    if (outcome.kind === 'requires-questions') {
      return {
        kind: 'requires-questions',
        questions: this.currentPendingQuestions() ?? outcome.questions,
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
      outcome.text,
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
    const finishSummary = extractFinishTaskSummary(request);
    if (finishSummary !== undefined && this.loopEnabled()) {
      this.completeTurn(this.completeFinishTaskToolCall(
        state,
        request,
        toolCallId,
        finishSummary,
        turn,
      ));
      return true;
    }

    const imageResult = await this.tryExecuteGenerateImageTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (imageResult !== undefined) {
      if (imageResult.kind !== 'completed' || imageResult.assistantText !== '') {
        this.completeTurn(imageResult);
        return true;
      }

      if (remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          imageResult.state,
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
          imageResult.state,
          pendingUserInput,
          turn,
          streamingEmitBeginResponse,
        );
        return true;
      }

      this.startToolAgentRoundAsync(imageResult.state, pendingUserInput, turn);
      return true;
    }

    const videoResult = await this.tryExecuteGenerateVideoTool(
      request,
      toolCallId,
      _toolName,
      state,
      turn,
    );
    if (videoResult !== undefined) {
      if (videoResult.kind !== 'completed' || videoResult.assistantText !== '') {
        this.completeTurn(videoResult);
        return true;
      }

      if (remainingCalls.length > 0) {
        this.queuePendingToolCallContinuation(
          videoResult.state,
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
          videoResult.state,
          pendingUserInput,
          turn,
          streamingEmitBeginResponse,
        );
        return true;
      }

      this.startToolAgentRoundAsync(videoResult.state, pendingUserInput, turn);
      return true;
    }

    const outcome = await this.tryExecuteRunSubagentTool(
      request,
      toolCallId,
      pendingUserInput,
      state,
      [],
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

    if (outcome.kind === 'requires-questions') {
      this.emitEvent({
        kind: 'questions-requested',
        questions: this.currentPendingQuestions() ?? outcome.questions,
      });
      return true;
    }

    if (outcome.kind === 'started') {
      this.ensureSubagentBatchContinuation(
        state,
        pendingUserInput,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
      );
      if (remainingCalls.length > 0) {
        await this.processToolCallsAsync(
          state,
          pendingUserInput,
          remainingCalls,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        );
      }
      return true;
    }

    const parentToolResultText = buildParentSubagentToolResultTextFromRequest(
      request,
      outcome.text,
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
      this.queuePendingToolCallContinuation(
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

  private completeFinishTaskToolCall(
    state: State,
    request: ToolRequest,
    toolCallId: string,
    summary: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): RuntimeTurnResult<State, ToolRequest, TrustTarget> {
    const output = summary.trim() || 'Task marked complete.';
    const content = createLlmMessageContentFromText(output);
    this.historyStore.push({
      role: 'tool',
      toolCallId,
      content,
    });
    turn.toolExecutions.push({
      toolCallId,
      toolName: 'finish_task',
      request,
      output,
      failed: false,
    });
    this.emitEvent({
      kind: 'tool-execution-finished',
      execution: {
        toolCallId,
        toolName: 'finish_task',
        request,
        output,
        failed: false,
      },
    });
    this.pendingUserTurnStore = undefined;
    return {
      kind: 'completed',
      assistantText: output,
      state,
      requestTrace: [...turn.requestTrace],
      toolExecutions: [...turn.toolExecutions],
      compactions: [...turn.compactions],
    };
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
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): Promise<void> {
    return processToolCallsAsyncInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
      state,
      pendingUserInput,
      calls,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      earlyToolExecutions,
    );
  }

  private queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming = false,
    streamingEmitBeginResponse = true,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void {
    this.pendingToolCallContinuation = {
      pendingUserInput,
      state,
      calls: [...calls],
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
    };
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
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
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
      earlyToolExecutions,
    );
  }

  private async pollPendingToolCallContinuation(): Promise<void> {
    const pending = this.pendingToolCallContinuation;
    if (!pending) {
      return;
    }

    this.pendingToolCallContinuation = undefined;
    await this.processToolCallsAsync(
      pending.state,
      pending.pendingUserInput,
      pending.calls,
      pending.turn,
      pending.resumeAsStreaming,
      pending.streamingEmitBeginResponse,
      pending.earlyToolExecutions,
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

  private completedViaFinishTask(
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>,
  ): boolean {
    return result.toolExecutions.some(
      (execution) => execution.toolName === 'finish_task' && !execution.failed,
    );
  }

  private storeCompletedTurnResult(
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>,
  ): void {
    this.completedTurnResultStore = result;
  }

  async waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    return waitForCompletedTurnResultInternal(
      this as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private async prepareSubmittedUserTurn(
    userInput: string,
    explicitImages: string[],
    explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
  ): Promise<State> {
    return prepareSubmittedUserTurnInternal(
      this as unknown as ContextRuntime<Config, State, ToolRequest, TrustTarget>,
      userInput,
      explicitImages,
      explicitWorkspaceFiles,
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
      const promptUserMessage = [...promptMessages]
        .reverse()
        .find((message) => message.role === 'user' && llmMessageTextContent(message.content).trim());
      userTurn = promptUserMessage
        ? llmMessageTextContent(promptUserMessage.content)
        : `请根据已应用的 MCP prompt ${prompt} 继续。`;
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
      if (this.completedViaFinishTask(result)) {
        return;
      }
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

    if (result.kind === 'requires-questions') {
      this.emitEvent({
        kind: 'questions-requested',
        questions: result.questions,
      });
      return;
    }

    this.emitEvent({
      kind: 'replace-pending-assistant',
      text: `LLM 调用失败: ${result.error}`,
    });
    this.emitEvent({ kind: 'assistant-response-completed' });
  }

  private emitEvent(event: RuntimeEvent<ToolRequest>): void {
    this.eventQueueStore.push(event);
    this.options.onEvent?.(event);
  }

  private clearPendingNonStreamingState(): void {
    this.pendingToolAgentRound = undefined;
    this.pendingToolCallContinuation = undefined;
    this.pendingBackgroundToolExecution = undefined;
    this.pendingHistoryCompaction = undefined;
    this.pendingQuestions = undefined;
    this.completedTurnResultStore = undefined;
    this.completedManualToolCommandResultStore = undefined;
    this.completedManualHistoryCompactionResultStore = undefined;
    this.thinkingSpinnerIndexStore = 0;
  }

  private currentAuxKind(): AssistantAuxKind | undefined {
    if (this.pendingSubagentExecutions.size > 0) {
      return 'thinking';
    }

    return currentAuxKindInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private currentAuxText(): string | undefined {
    if (this.pendingSubagentExecutions.size > 0) {
      return undefined;
    }

    return currentAuxTextInternal(
      this as unknown as StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
    );
  }

  private currentSubagentStatusText(): string {
    const pendingCount = this.pendingSubagentExecutions.size;
    const pending = this.firstPendingSubagentExecution();
    if (!pending) {
      return 'SubAgent: 运行中';
    }

    if (pendingCount > 1) {
      return `SubAgent: ${pendingCount} running`;
    }

    const title = pending.childRecord.summary.title.trim() || 'SubAgent';
    const childApproval = pending.childRuntime.currentPendingApproval();
    if (childApproval) {
      return `${title}: 等待确认 ${childApproval.toolName}`;
    }

    const pendingAssistantProgress = normalizeSubagentStatusProgress(
      pending.childRuntime.pendingAssistantText(),
      title,
    );
    if (pendingAssistantProgress) {
      return `${title}: ${truncateTextForSubagentSummary(pendingAssistantProgress, 120)}`;
    }

    const backgroundProgress = normalizeSubagentStatusProgress(
      pending.childRuntime.backgroundToolStatus(),
      title,
    );
    if (backgroundProgress) {
      return `${title}: ${truncateTextForSubagentSummary(backgroundProgress, 120)}`;
    }

    const thinkingProgress = normalizeSubagentStatusProgress(
      pending.childRuntime.thinkingText(),
      title,
    );
    if (thinkingProgress) {
      return `${title}: ${truncateTextForSubagentSummary(thinkingProgress, 120)}`;
    }

    if (!pending.childRuntime.isBusy()) {
      const completedProgress = normalizeSubagentStatusProgress(
        resolveSubagentResultText('', pending.childRecord, false),
        title,
      );
      if (completedProgress) {
        return `${title}: ${truncateTextForSubagentSummary(completedProgress, 120)}`;
      }

      return `${title}: 已完成`;
    }

    const progress = normalizeSubagentStatusProgress(
      pending.childRecord.summary.latestMessage,
      title,
    );
    if (!progress) {
      return `${title}: 运行中`;
    }

    return `${title}: ${truncateTextForSubagentSummary(progress, 120)}`;
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
    toolCallId?: string,
  ): Promise<{
    output: ToolExecutionOutput;
    failed: boolean;
    backgroundExecution: boolean;
  }> {
    return performToolExecutionInternal(
      this as unknown as ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
      request,
      toolName,
      toolCallId,
    );
  }

  private async tryPerformEarlyInternalToolCall(
    request: ToolRequest,
    toolCallId: string,
    _toolName: string,
  ): Promise<EarlyInternalToolCallResult | undefined> {
    if (extractFinishTaskSummary(request) !== undefined) {
      return { kind: 'defer-to-formal' };
    }

    const imageRequest = extractGenerateImageRequest(request);
    if (imageRequest !== undefined) {
      try {
        if (!this.options.generateImage) {
          throw new Error('No image generation executor is configured.');
        }

        const output = await this.options.generateImage(imageRequest);
        return {
          kind: 'completed',
          output,
          failed: false,
          enqueueDeferredGuidance: false,
        };
      } catch (error) {
        const message = renderError(error);
        return {
          kind: 'completed',
          output: createToolExecutionTextOutput(`generate_image failed: ${message}`),
          failed: true,
          enqueueDeferredGuidance: false,
          fatalError: message,
        };
      }
    }

    const videoRequest = extractGenerateVideoRequest(request);
    if (videoRequest !== undefined) {
      try {
        if (!this.options.generateVideo) {
          throw new Error('No video generation executor is configured.');
        }

        const output = await this.options.generateVideo(videoRequest);
        return {
          kind: 'completed',
          output,
          failed: false,
          enqueueDeferredGuidance: false,
        };
      } catch (error) {
        const message = renderError(error);
        return {
          kind: 'completed',
          output: createToolExecutionTextOutput(`generate_video failed: ${message}`),
          failed: true,
          enqueueDeferredGuidance: false,
          fatalError: message,
        };
      }
    }

    if (extractRunSubagentRequest(request) !== undefined) {
      return { kind: 'defer-to-formal' };
    }

    return undefined;
  }

  private persistToolExecutionResult(output: ToolExecutionOutput, toolCallId?: string): void {
    persistToolExecutionResultInternal(
      this as unknown as ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
      output,
      toolCallId,
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

  private async tryExecuteGenerateImageTool(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined> {
    const imageRequest = extractGenerateImageRequest(request);
    if (imageRequest === undefined) {
      return undefined;
    }

    try {
      if (!this.options.generateImage) {
        throw new Error('No image generation executor is configured.');
      }

      const output = await this.options.generateImage(imageRequest);
      const resumedState = this.options.appendToolResultMessage(
        state,
        toolCallId,
        output.summaryText,
      );
      this.finishGenerateImageToolCall(
        request,
        toolCallId,
        toolName,
        output.summaryText,
        false,
        turn,
        toolArtifactsFromOutput(output),
      );
      this.persistToolExecutionResult(output, toolCallId);

      return {
        kind: 'completed',
        assistantText: '',
        state: resumedState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    } catch (error) {
      const message = renderError(error);
      this.finishGenerateImageToolCall(
        request,
        toolCallId,
        toolName,
        `generate_image failed: ${message}`,
        true,
        turn,
      );
      return this.failedTurnResult(message, state, turn);
    }
  }

  private finishGenerateImageToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>['artifacts'],
  ): RuntimeToolExecution<ToolRequest> {
    return this.finishInternalMediaGenerationToolCall(
      request,
      toolCallId,
      toolName,
      output,
      failed,
      turn,
      artifacts,
    );
  }

  private async tryExecuteGenerateVideoTool(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined> {
    const videoRequest = extractGenerateVideoRequest(request);
    if (videoRequest === undefined) {
      return undefined;
    }

    try {
      if (!this.options.generateVideo) {
        throw new Error('No video generation executor is configured.');
      }

      const output = await this.options.generateVideo(videoRequest);
      const resumedState = this.options.appendToolResultMessage(
        state,
        toolCallId,
        output.summaryText,
      );
      this.finishGenerateVideoToolCall(
        request,
        toolCallId,
        toolName,
        output.summaryText,
        false,
        turn,
        toolArtifactsFromOutput(output),
      );
      this.persistToolExecutionResult(output, toolCallId);

      return {
        kind: 'completed',
        assistantText: '',
        state: resumedState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    } catch (error) {
      const message = renderError(error);
      this.finishGenerateVideoToolCall(
        request,
        toolCallId,
        toolName,
        `generate_video failed: ${message}`,
        true,
        turn,
      );
      return this.failedTurnResult(message, state, turn);
    }
  }

  private finishGenerateVideoToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>['artifacts'],
  ): RuntimeToolExecution<ToolRequest> {
    return this.finishInternalMediaGenerationToolCall(
      request,
      toolCallId,
      toolName,
      output,
      failed,
      turn,
      artifacts,
    );
  }

  private finishInternalMediaGenerationToolCall(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    output: string,
    failed: boolean,
    turn: RuntimeTurnContext<ToolRequest>,
    artifacts?: RuntimeToolExecution<ToolRequest>['artifacts'],
  ): RuntimeToolExecution<ToolRequest> {
    const finished: RuntimeToolExecution<ToolRequest> = {
      toolCallId,
      toolName,
      request,
      output,
      failed,
      ...(artifacts ? { artifacts } : {}),
    };
    turn.toolExecutions.push(finished);
    this.emitEvent({ kind: 'tool-execution-finished', execution: finished });
    return finished;
  }

  private failedTurnResult(
    error: string,
    state: State,
    turn: RuntimeTurnContext<ToolRequest>,
  ): RuntimeTurnResult<State, ToolRequest, TrustTarget> {
    return {
      kind: 'failed',
      error,
      state,
      requestTrace: [...turn.requestTrace],
      toolExecutions: [...turn.toolExecutions],
      compactions: [...turn.compactions],
    };
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
      content: createLlmMessageContentFromText(childUserTurn),
    }];
    record.summary.latestMessage = truncateTextForSubagentSummary(request.task.trim(), 180);

    if (resumeAsStreaming) {
      try {
        await childRuntime.startUserTurnStreaming(childUserTurn);
        this.cachePendingSubagentExecution({
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
        });
        this.refreshChildSessionRecord(record, childRuntime);
        record.summary.status = childRuntime.currentPendingApproval() ? 'blocked' : 'running';
        return { kind: 'started' };
      } catch (error) {
        const failed = `[subagent failed] ${renderError(error)}`;
        record.summary.status = 'failed';
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
        record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
        delete record.summary.finalOutput;
        record.summary.error = failed;
        return { kind: 'completed', text: failed, failed: true };
      }
    }

    try {
      const result = await childRuntime.submitUserTurn(childUserTurn);
      this.refreshChildSessionRecord(record, childRuntime);

      if (result.kind === 'completed') {
        const finalOutput = resolveSubagentResultText(result.assistantText, record, false);
        record.summary.status = 'completed';
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
        record.summary.latestMessage = truncateTextForSubagentSummary(finalOutput, 180);
        record.summary.finalOutput = finalOutput;
        delete record.summary.error;
        return { kind: 'completed', text: finalOutput, failed: false };
      }

      if (result.kind === 'requires-approval') {
        record.summary.status = 'blocked';
        record.summary.updatedAtUnixMs = Date.now();
        record.summary.latestMessage = `等待前台确认: ${result.approval.toolName}`;
        delete record.summary.completedAtUnixMs;
        delete record.summary.finalOutput;
        delete record.summary.error;
        this.cachePendingSubagentExecution(this.buildPendingSubagentExecution(
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRuntime,
          record,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        ));
        return { kind: 'requires-approval', approval: result.approval };
      }

      if (result.kind === 'requires-questions') {
        this.updateSubagentQuestionsBlockedState(record, result.questions);
        this.cachePendingSubagentExecution(this.buildPendingSubagentExecution(
          parentRequest,
          parentToolCallId,
          parentPendingUserInput,
          parentState,
          parentRemainingCalls,
          parentTurn,
          childRuntime,
          record,
          resumeAsStreaming,
          streamingEmitBeginResponse,
        ));
        return {
          kind: 'requires-questions',
          questions: childRuntime.currentPendingQuestions() ?? result.questions,
        };
      }

      const failed = `[subagent failed] ${result.error}`;
      record.summary.status = 'failed';
      record.summary.updatedAtUnixMs = Date.now();
      record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
      record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
      delete record.summary.finalOutput;
      record.summary.error = failed;
      return { kind: 'completed', text: failed, failed: true };
    } catch (error) {
      const failed = `[subagent failed] ${renderError(error)}`;
      record.summary.status = 'failed';
      record.summary.updatedAtUnixMs = Date.now();
      record.summary.completedAtUnixMs = record.summary.updatedAtUnixMs;
      record.summary.latestMessage = truncateTextForSubagentSummary(failed, 180);
      delete record.summary.finalOutput;
      record.summary.error = failed;
      return { kind: 'completed', text: failed, failed: true };
    }
  }

  private refreshChildSessionRecord(
    record: RuntimeSubagentSessionArchiveEntry,
    childRuntime: AgentRuntime<Config, State, ToolRequest, TrustTarget>,
  ): void {
    record.llmHistory = childRuntime.history().map((message) => serializeRuntimeLlmMessageForArchive(message));
    const pendingAssistant = childRuntime.pendingAssistantText().trim();
    if (pendingAssistant.length > 0) {
      record.llmHistory.push({
        role: 'assistant',
        content: createLlmMessageContentFromText(pendingAssistant),
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
    const pending = this.findPendingSubagentWithApproval();
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
    if (this.pendingSubagentExecutions.size === 0) {
      return;
    }

    for (const pending of [...this.pendingSubagentExecutions.values()]) {
      await pending.childRuntime.poll();
      // 不在此处 drain：子会话事件由 desktop syncSubagentConversationProjections 消费。
      this.refreshChildSessionRecord(pending.childRecord, pending.childRuntime);

      const childApproval = pending.childRuntime.currentPendingApproval();
      if (childApproval) {
        pending.childRecord.summary.status = 'blocked';
        pending.childRecord.summary.latestMessage = `等待前台确认: ${childApproval.toolName}`;
        delete pending.childRecord.summary.completedAtUnixMs;
        delete pending.childRecord.summary.finalOutput;
        delete pending.childRecord.summary.error;
        continue;
      }

      const result = pending.childRuntime.takeCompletedTurnResult();
      if (!result) {
        if (pending.childRuntime.isBusy()) {
          pending.childRecord.summary.status = 'running';
        }
        continue;
      }

      if (result.kind === 'requires-approval') {
        pending.childRecord.summary.status = 'blocked';
        pending.childRecord.summary.latestMessage = `等待前台确认: ${result.approval.toolName}`;
        continue;
      }

      if (result.kind === 'requires-questions') {
        this.updateSubagentQuestionsBlockedState(
          pending.childRecord,
          pending.childRuntime.currentPendingQuestions() ?? result.questions,
        );
        continue;
      }

      if (result.kind === 'completed' || result.kind === 'failed') {
        await this.finishPendingSubagentExecution(pending, result);
      }
    }
  }

  private async finishPendingSubagentExecution(
    pending: PendingSubagentExecution<Config, State, ToolRequest, TrustTarget>,
    result: Extract<RuntimeTurnResult<State, ToolRequest, TrustTarget>, { kind: 'completed' | 'failed' }>,
  ): Promise<void> {
    this.pendingSubagentExecutions.delete(pending.parentToolCallId);

    const output = result.kind === 'completed'
      ? { text: resolveSubagentResultText(result.assistantText, pending.childRecord, false), failed: false }
      : {
          text: resolveSubagentResultText(
            `[subagent failed] ${result.error}`,
            pending.childRecord,
            true,
          ),
          failed: true,
        };
    const parentToolResultText = buildParentSubagentToolResultText(
      pending.childRecord.summary.title,
      output.text,
      output.failed,
      pending.childRecord.summary.sessionId,
    );

    pending.childRecord.summary.status = output.failed ? 'failed' : 'completed';
    pending.childRecord.summary.updatedAtUnixMs = Date.now();
    pending.childRecord.summary.completedAtUnixMs = pending.childRecord.summary.updatedAtUnixMs;
    pending.childRecord.summary.latestMessage = truncateTextForSubagentSummary(output.text, 180);
    if (output.failed) {
      pending.childRecord.summary.error = output.text;
      delete pending.childRecord.summary.finalOutput;
    } else {
      pending.childRecord.summary.finalOutput = output.text;
      delete pending.childRecord.summary.error;
    }

    const finishedExecution = {
      toolCallId: pending.parentToolCallId,
      toolName: 'run_subagent',
      request: pending.parentRequest,
      output: output.text,
      failed: output.failed,
    };
    pending.parentTurn.toolExecutions.push(finishedExecution);
    this.emitEvent({ kind: 'tool-execution-finished', execution: finishedExecution });

    const batch = this.pendingSubagentBatchContinuation;
    const baseState = batch?.parentState ?? pending.parentState;
    const resumedState = this.options.appendToolResultMessage(
      baseState,
      pending.parentToolCallId,
      parentToolResultText,
    );
    if (batch) {
      batch.parentState = resumedState;
    }

    if (this.pendingSubagentExecutions.size > 0) {
      return;
    }

    const finalState = batch?.parentState ?? resumedState;
    const continuation = batch ?? {
      parentPendingUserInput: pending.parentPendingUserInput,
      parentTurn: pending.parentTurn,
      resumeAsStreaming: pending.resumeAsStreaming,
      streamingEmitBeginResponse: pending.streamingEmitBeginResponse,
    };
    this.pendingSubagentBatchContinuation = undefined;

    if (pending.parentRemainingCalls.length > 0) {
      await this.processToolCallsAsync(
        finalState,
        continuation.parentPendingUserInput,
        pending.parentRemainingCalls,
        continuation.parentTurn,
        continuation.resumeAsStreaming,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    if (continuation.resumeAsStreaming) {
      await this.startStreamingRound(
        finalState,
        continuation.parentPendingUserInput,
        continuation.parentTurn,
        continuation.streamingEmitBeginResponse,
      );
      return;
    }

    this.startToolAgentRoundAsync(
      finalState,
      continuation.parentPendingUserInput,
      continuation.parentTurn,
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

function extractGenerateImageRequest<ToolRequest>(request: ToolRequest): ImageGenerationRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: Record<string, JsonValue>;
  if (readOptionalStringField(request, 'name') === 'generate_image') {
    if (readOptionalStringField(request, 'prompt') !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, 'argumentsJson');
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!('GenerateImage' in request)) {
      return undefined;
    }

    const candidate = request.GenerateImage;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }

  const prompt = readOptionalStringField(value, 'prompt');
  if (prompt === undefined) {
    return undefined;
  }

  return {
    prompt,
    size: readOptionalStringField(value, 'size') ?? DEFAULT_IMAGE_GENERATION_SIZE,
  };
}

function extractGenerateVideoRequest<ToolRequest>(request: ToolRequest): VideoGenerationRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: Record<string, JsonValue>;
  if (readOptionalStringField(request, 'name') === 'generate_video') {
    if (readOptionalStringField(request, 'prompt') !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, 'argumentsJson');
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!('GenerateVideo' in request)) {
      return undefined;
    }

    const candidate = request.GenerateVideo;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }

  const prompt = readOptionalStringField(value, 'prompt');
  if (prompt === undefined) {
    return undefined;
  }

  const durationField = value.duration;
  const duration = typeof durationField === 'number' && Number.isFinite(durationField)
    ? durationField
    : undefined;

  const aspectRatio = readOptionalStringField(value, 'aspect_ratio');
  const resolution = readOptionalStringField(value, 'resolution');

  return {
    prompt,
    duration: duration ?? DEFAULT_VIDEO_GENERATION_DURATION,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function extractFinishTaskSummary<ToolRequest>(request: ToolRequest): string | undefined {
  if (!isJsonObject(request) || readOptionalStringField(request, 'name') !== 'finish_task') {
    return undefined;
  }

  return readOptionalStringField(request, 'summary') ?? '';
}

function extractRunSubagentRequest<ToolRequest>(request: ToolRequest): RunSubagentRequest | undefined {
  if (!isJsonObject(request)) {
    return undefined;
  }

  let value: JsonValue;
  if (readOptionalStringField(request, 'name') === 'run_subagent') {
    if (readOptionalStringField(request, 'task') !== undefined) {
      value = request;
    } else {
      const argumentsJson = readOptionalStringField(request, 'argumentsJson');
      if (argumentsJson === undefined) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(argumentsJson) as JsonValue;
        if (!isJsonObject(parsed)) {
          return undefined;
        }
        value = parsed;
      } catch {
        return undefined;
      }
    }
  } else {
    if (!('RunSubagent' in request)) {
      return undefined;
    }

    const candidate = request.RunSubagent;
    if (!isJsonObject(candidate)) {
      return undefined;
    }

    value = isJsonObject(candidate.request) ? candidate.request : candidate;
  }
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
  title: string,
  outputText: string,
  failed: boolean,
  sessionId?: string,
): string {
  const normalizedTitle = title.trim() || 'SubAgent';
  const normalizedOutput = outputText.trim();
  const header = failed ? '[subagent failed]' : '[subagent completed]';
  const sessionLine = sessionId?.trim() ? `sessionId=${sessionId}\n` : '';
  if (!normalizedOutput) {
    return `${header}\ntitle=${normalizedTitle}${sessionLine ? `\n${sessionLine.trimEnd()}` : ''}`;
  }

  const label = failed ? 'error:' : 'final_output:';
  return `${header}\ntitle=${normalizedTitle}\n${sessionLine}${label}\n${truncateTextForParentSubagentResult(normalizedOutput, 6000)}`;
}

function buildParentSubagentToolResultTextFromRequest<ToolRequest>(
  request: ToolRequest,
  outputText: string,
  failed: boolean,
): string {
  const subagent = extractRunSubagentRequest(request);
  const title = truncateTextForSubagentSummary(subagent?.task?.trim() ?? '', 72) || 'SubAgent';
  return buildParentSubagentToolResultText(title, outputText, failed);
}

function resolveSubagentResultText(
  outputText: string,
  record: RuntimeSubagentSessionArchiveEntry,
  failed: boolean,
): string {
  const normalizedOutput = outputText.trim();
  if (normalizedOutput.length > 0) {
    return normalizedOutput;
  }

  if (failed) {
    return record.summary.error?.trim() || record.summary.latestMessage?.trim() || normalizedOutput;
  }

  return record.summary.finalOutput?.trim()
    || latestAssistantMessage(record.llmHistory)?.trim()
    || record.summary.latestMessage?.trim()
    || normalizedOutput;
}

function truncateTextForParentSubagentResult(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  return `${chars.slice(0, maxChars).join('')}\n\n...<subagent result truncated>`;
}

function singleLineStatusText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeSubagentStatusProgress(text: string | undefined, title: string): string | undefined {
  const normalized = singleLineStatusText(text ?? '');
  if (!normalized || normalized === title || normalized === 'Thinking...' || normalized === 'Compressing...') {
    return undefined;
  }

  return normalized;
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
    const text = message ? llmMessageTextContent(message.content).trim() : '';
    if (message?.role === 'assistant' && text.length > 0) {
      return truncateTextForSubagentSummary(text, 180);
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

function serializeRuntimeLlmMessageForArchive(message: LlmMessage): StoredLlmMessageArchiveEntry {
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
    ...(message.providerState !== undefined
      ? { providerState: cloneLlmProviderState(message.providerState) }
      : {}),
  };
}
