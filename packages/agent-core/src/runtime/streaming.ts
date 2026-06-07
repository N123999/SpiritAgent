import { emitContextUsageUpdated } from './context-usage.js';
import {
  createLlmMessageContentFromText,
  type LlmMessage,
  type LlmStreamEvent,
  type ToolAgentRoundCompletion,
  type ToolCallRequest,
} from '../ports.js';

import { STREAM_EVENT_BUDGET_PER_POLL, STREAM_STALL_TIMEOUT_MS } from './constants.js';
import {
  applyDeferredUserGuidance,
  appendLoopContinuationGuidance,
  cloneHistory,
  renderError,
} from './helpers.js';
import type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingEarlyToolExecution,
  PendingBackgroundToolExecution,
  PendingHistoryCompaction,
  PendingStreamingRound,
  PendingToolAgentRound,
  RuntimeEvent,
  RuntimeTurnResult,
  RuntimeTurnContext,
} from './types.js';
import type { ToolExecutionResult } from './tool-execution.js';
import type { EarlyInternalToolCallResult, TurnMachineRuntime } from './turn-machine.js';
import { isResponsesBuiltInToolName } from '../open-responses/responses-built-in-tools.js';
import { startEarlyToolExecution } from './turn-machine.js';

export interface StreamingRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  pendingUserTurnStore: string | undefined;
  pendingStreamingRound: PendingStreamingRound<State, ToolRequest> | undefined;
  pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  pendingBackgroundToolStatusStore: string | undefined;
  pendingAssistantTextStore: string;
  thinkingTextStore: string;
  /** Set when a tool preview appears in the current streaming round (cleared with streaming UI state). */
  toolPreviewSeenInStreamRoundStore: boolean;
  compactionTextStore: string;
  pendingStartedAtStore: number | undefined;
  pendingLastEventAtStore: number | undefined;
  streamChunkCounterStore: number;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  appendTrace(trace: unknown[], turn: RuntimeTurnContext<ToolRequest>): void;
  storeCompletedTurnResult(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void;
  startHistoryCompactionAsync(
    retryState: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    originalError: string,
    toolTruncationApplied: boolean,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): void;
  processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): Promise<void>;
  queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void;
  performToolExecution(
    request: ToolRequest,
    toolName: string,
    toolCallId?: string,
  ): Promise<ToolExecutionResult>;
  tryPerformEarlyInternalToolCall?(
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
  ): Promise<EarlyInternalToolCallResult | undefined>;
  loopEnabled(): boolean;
}

export function handleStreamStallTimeout<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
  nowMs = Date.now(),
  stallTimeoutMs = STREAM_STALL_TIMEOUT_MS,
): void {
  const pending = runtime.pendingStreamingRound;
  if (!pending) {
    return;
  }

  if (!pending.completionHandled) {
    return;
  }

  const lastEventAt = runtime.pendingLastEventAtStore;
  if (lastEventAt === undefined || nowMs - lastEventAt < stallTimeoutMs) {
    return;
  }

  if (!runtime.pendingAssistantTextStore.trim()) {
    runtime.emitEvent({
      kind: 'replace-pending-assistant',
      text: '流式响应超时，连接已中断。',
    });
  } else {
    const suffix = '\n\n[stream timeout] 响应长时间无数据，已自动停止等待。';
    runtime.pendingAssistantTextStore += suffix;
    runtime.emitEvent({
      kind: 'assistant-chunk',
      text: suffix,
    });
  }

  runtime.pendingUserTurnStore = undefined;
  clearPendingStreamingState(runtime);
  runtime.emitEvent({ kind: 'assistant-response-completed' });
}

export async function startStreamingRound<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
  emitBeginResponse: boolean,
): Promise<void> {
  ({ state, pendingUserInput } = applyDeferredUserGuidance(
    runtime,
    state,
    pendingUserInput,
    turn,
  ));
  clearPendingStreamingState(runtime);
  runtime.pendingStartedAtStore = Date.now();
  runtime.pendingLastEventAtStore = runtime.pendingStartedAtStore;

  const pending: PendingStreamingRound<State, ToolRequest> = {
    pendingUserInput,
    turn,
    rawEvents: [],
    earlyToolExecutions: new Map(),
    completion: undefined,
    completionHandled: false,
    streamEnded: false,
    streamConsumerFinished: false,
    cancel: undefined,
  };
  runtime.pendingStreamingRound = pending;

  if (emitBeginResponse) {
    runtime.emitEvent({ kind: 'begin-assistant-response' });
  }

  const transport = runtime.options.llmTransport;
  if (transport.startToolAgentRoundStreaming) {
    void transport.startToolAgentRoundStreaming(
      runtime.options.config,
      state,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    )
      .then((started) => {
        if (runtime.pendingStreamingRound !== pending) {
          started.cancel?.();
          return;
        }

        pending.cancel = started.cancel;
        void consumeStreamEvents(runtime, pending, started.eventStream);
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
      })
      .catch((error: unknown) => {
        if (runtime.pendingStreamingRound !== pending) {
          return;
        }

        pending.completion = {
          kind: 'failure',
          error: renderError(error),
          requestTrace: [],
        };
      });
    return;
  }

  void runtime.options.llmTransport
    .startToolAgentRound(
      runtime.options.config,
      state,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    )
    .then((completion) => {
      pending.completion = completion;
      if (completion.kind === 'success' && completion.result.step.kind === 'final-response-ready') {
        const assistantText = runtime.options.extractAssistantText(completion.result.state)?.trim();
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

export async function pollPendingStreamingRound<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<void> {
  const pending = runtime.pendingStreamingRound;
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
    const shouldBreak = await handlePendingStreamEvent(runtime, pending, event);
    if (shouldBreak || runtime.pendingStreamingRound !== pending) {
      break;
    }
  }

  if (runtime.pendingStreamingRound !== pending || pending.completionHandled || !pending.completion) {
    return;
  }

  // completion resolves in parallel with consumeStreamEvents; wait until the
  // stream iterator is fully ingested and every queued event is handled.
  if (pending.rawEvents.length > 0 || !pending.streamConsumerFinished) {
    return;
  }

  pending.completionHandled = true;
  await handlePendingStreamingCompletion(runtime, pending, pending.completion);
}

export function currentAuxKind<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): AssistantAuxKind | undefined {
  if (runtime.pendingHistoryCompaction) {
    return 'compressing';
  }

  if (
    runtime.pendingStreamingRound !== undefined ||
    runtime.pendingToolAgentRound !== undefined ||
    runtime.pendingBackgroundToolExecution !== undefined
  ) {
    // Body is streaming; only surface aux while a reasoning/compaction buffer exists.
    if (
      runtime.pendingAssistantTextStore.trim() &&
      !runtime.thinkingTextStore.trim() &&
      !runtime.compactionTextStore.trim() &&
      !runtime.pendingBackgroundToolStatusStore?.trim()
    ) {
      return undefined;
    }
    return 'thinking';
  }

  return undefined;
}

export function currentAuxText<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): string | undefined {
  if (runtime.pendingBackgroundToolStatusStore?.trim()) {
    return runtime.pendingBackgroundToolStatusStore;
  }

  if (runtime.pendingHistoryCompaction && runtime.compactionTextStore.trim()) {
    return runtime.compactionTextStore;
  }

  if (
    (runtime.pendingStreamingRound !== undefined ||
      runtime.pendingToolAgentRound !== undefined ||
      runtime.pendingBackgroundToolExecution !== undefined) &&
    runtime.thinkingTextStore.trim()
  ) {
    return runtime.thinkingTextStore;
  }

  return undefined;
}

function finalizeInFlightStreamThinking<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): void {
  if (!runtime.thinkingTextStore.trim()) {
    return;
  }
  const placement = runtime.toolPreviewSeenInStreamRoundStore
    ? 'before-next-tool'
    : 'after-stream';
  runtime.emitEvent({
    kind: 'assistant-thinking-segment-finalized',
    text: runtime.thinkingTextStore,
    placement,
  });
  runtime.thinkingTextStore = '';
}

export function clearStreamingUiState<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): void {
  finalizeInFlightStreamThinking(runtime);
  runtime.pendingStartedAtStore = undefined;
  runtime.pendingLastEventAtStore = undefined;
  runtime.streamChunkCounterStore = 0;
  runtime.pendingAssistantTextStore = '';
  runtime.thinkingTextStore = '';
  runtime.compactionTextStore = '';
  runtime.toolPreviewSeenInStreamRoundStore = false;
}

export function clearPendingStreamingState<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): void {
  runtime.pendingStreamingRound?.cancel?.();
  runtime.pendingStreamingRound = undefined;
  clearStreamingUiState(runtime);
}

export async function consumeStreamEvents<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
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
  } finally {
    pending.streamConsumerFinished = true;
  }
}

export async function handlePendingStreamEvent<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
  pending: PendingStreamingRound<State, ToolRequest>,
  event: LlmStreamEvent,
): Promise<boolean> {
  runtime.pendingLastEventAtStore = Date.now();

  if (event.kind === 'thinking-chunk') {
    runtime.thinkingTextStore += event.text;
    runtime.emitEvent({
      kind: 'update-pending-assistant-thinking',
      text: runtime.thinkingTextStore,
    });
    return false;
  }

  if (event.kind === 'streaming-tool-preview') {
    runtime.toolPreviewSeenInStreamRoundStore = true;
    if (runtime.thinkingTextStore.trim()) {
      finalizeInFlightStreamThinking(runtime);
    }
    runtime.emitEvent({
      kind: 'streaming-tool-preview',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      argumentsJson: event.argumentsJson,
    });
    const allowEarlyExecutionDuringStream =
      event.toolName === 'read_file' || event.toolName === 'list_directory_files';
    if (
      !isResponsesBuiltInToolName(event.toolName)
      && (allowEarlyExecutionDuringStream || pending.streamConsumerFinished)
    ) {
      startEarlyToolExecution(
        runtime as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
        {
          id: event.toolCallId,
          name: event.toolName,
          argumentsJson: event.argumentsJson,
        },
        pending.earlyToolExecutions,
      );
    }
    return false;
  }

  if (event.kind === 'assistant-chunk') {
    if (runtime.thinkingTextStore.trim()) {
      finalizeInFlightStreamThinking(runtime);
    }
    runtime.streamChunkCounterStore += 1;
    runtime.pendingAssistantTextStore += event.text;
    runtime.emitEvent({
      kind: 'assistant-chunk',
      text: event.text,
    });
    return false;
  }

  if (event.kind === 'history-compacted') {
    runtime.historyStore = cloneHistory(event.newHistory);
    const summaryPreview = runtime.options.llmTransport.compactSummaryText(runtime.historyStore);
    runtime.emitEvent({
      kind: 'history-compacted',
      droppedMessages: event.droppedMessages,
      ...(summaryPreview !== undefined ? { summaryPreview } : {}),
    });
    return false;
  }

  if (event.kind === 'done') {
    pending.streamEnded = true;
    const resumeAfterProviderSearch =
      pending.completion?.kind === 'success'
      && pending.completion.result.resumeStreamingAfterProviderSearch === true;
    if (!runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({ kind: 'remove-pending-assistant' });
    } else if (!resumeAfterProviderSearch) {
      runtime.historyStore.push({
        role: 'assistant',
        content: createLlmMessageContentFromText(runtime.pendingAssistantTextStore),
      });
      runtime.pendingUserTurnStore = undefined;
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    }

    clearStreamingUiState(runtime);

    if (pending.completionHandled && pending.completion?.kind === 'success') {
      const round = pending.completion.result;
      if (round.resumeStreamingAfterProviderSearch) {
        clearPendingStreamingState(runtime);
        await startStreamingRound(runtime, round.state, pending.pendingUserInput, pending.turn, false);
        return true;
      }
      if (round.step.kind === 'tool-calls') {
        const earlyToolExecutions = pending.earlyToolExecutions;
        clearPendingStreamingState(runtime);
        runtime.queuePendingToolCallContinuation(
          round.state,
          pending.pendingUserInput,
          round.step.calls,
          pending.turn,
          true,
          true,
          earlyToolExecutions,
        );
        return true;
      }

      const assistantText = runtime.options.extractAssistantText(round.state)?.trim();
      if (assistantText) {
        if (runtime.loopEnabled()) {
          clearPendingStreamingState(runtime);
          const continuationState = appendLoopContinuationGuidance(
            runtime,
            round.state,
            pending.pendingUserInput,
          );
          await startStreamingRound(runtime, continuationState, pending.pendingUserInput, pending.turn, true);
          return true;
        }
        runtime.storeCompletedTurnResult({
          kind: 'completed',
          assistantText,
          state: round.state,
          requestTrace: [...pending.turn.requestTrace],
          toolExecutions: [...pending.turn.toolExecutions],
          compactions: [...pending.turn.compactions],
        });
      }
      clearPendingStreamingState(runtime);
    }

    return true;
  }

  if (
    runtime.options.llmTransport.isContextOverflowError(event.error) &&
    pending.turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
  ) {
    pending.turn.autoCompactAttempts += 1;
    const preparedRetry = runtime.options.truncateStateForContextRetry
      ? runtime.options.truncateStateForContextRetry(
          runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput),
        )
      : {
          state: runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput),
          changed: false,
        };

    if (runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({ kind: 'replace-pending-assistant', text: '' });
    }
    clearPendingStreamingState(runtime);
    runtime.startHistoryCompactionAsync(
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

  if (!runtime.pendingAssistantTextStore.trim()) {
    runtime.emitEvent({
      kind: 'replace-pending-assistant',
      text: `LLM 调用失败: ${event.error}`,
    });
  } else {
    const suffix = `\n\n[Error] ${event.error}`;
    runtime.pendingAssistantTextStore += suffix;
    runtime.emitEvent({
      kind: 'assistant-chunk',
      text: suffix,
    });
  }

  runtime.pendingUserTurnStore = undefined;
  clearPendingStreamingState(runtime);
  runtime.emitEvent({ kind: 'assistant-response-completed' });
  return true;
}

export async function handlePendingStreamingCompletion<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
  pending: PendingStreamingRound<State, ToolRequest>,
  completion: ToolAgentRoundCompletion<State>,
): Promise<void> {
  if (completion.kind === 'failure') {
    runtime.appendTrace(completion.requestTrace, pending.turn);

    if (
      runtime.options.llmTransport.isContextOverflowError(completion.error) &&
      pending.turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
    ) {
      pending.turn.autoCompactAttempts += 1;
      const preparedRetry = runtime.options.truncateStateForContextRetry
        ? runtime.options.truncateStateForContextRetry(
            runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput),
          )
        : {
            state: runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput),
            changed: false,
          };

      if (runtime.pendingAssistantTextStore.trim()) {
        runtime.emitEvent({ kind: 'replace-pending-assistant', text: '' });
      }
      clearPendingStreamingState(runtime);
      runtime.startHistoryCompactionAsync(
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

    if (!runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: `LLM 调用失败: ${completion.error}`,
      });
    }
    runtime.pendingUserTurnStore = undefined;
    clearPendingStreamingState(runtime);
    runtime.storeCompletedTurnResult({
      kind: 'failed',
      error: completion.error,
      requestTrace: [...pending.turn.requestTrace],
      toolExecutions: [...pending.turn.toolExecutions],
      compactions: [...pending.turn.compactions],
    });
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    return;
  }

  const round = completion.result;
  runtime.appendTrace(round.requestTrace, pending.turn);
  emitContextUsageUpdated(runtime.emitEvent.bind(runtime), round.usage);

  if (round.resumeStreamingAfterProviderSearch) {
    const lastHistoryMessage = runtime.historyStore.at(-1);
    if (lastHistoryMessage?.role === 'assistant') {
      runtime.historyStore.pop();
    }
    clearPendingStreamingState(runtime);
    await startStreamingRound(runtime, round.state, pending.pendingUserInput, pending.turn, false);
    return;
  }

  if (round.step.kind === 'tool-calls') {
    if (!pending.streamEnded && !runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({ kind: 'remove-pending-assistant' });
    } else if (!pending.streamEnded && runtime.pendingAssistantTextStore.trim()) {
      // 与流式 `done` 分支一致：completion 先于 `done` 事件到达时，须把已输出的正文写入 history，
      // 否则 `clearPendingStreamingState` 会丢弃例如「OK」等前缀。
      runtime.historyStore.push({
        role: 'assistant',
        content: createLlmMessageContentFromText(runtime.pendingAssistantTextStore),
      });
      runtime.pendingUserTurnStore = undefined;
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    }
    const earlyToolExecutions = pending.earlyToolExecutions;
    clearPendingStreamingState(runtime);
    runtime.queuePendingToolCallContinuation(
      round.state,
      pending.pendingUserInput,
      round.step.calls,
      pending.turn,
      true,
      true,
      earlyToolExecutions,
    );
    return;
  }

  const assistantText = runtime.options.extractAssistantText(round.state)?.trim();
  if (!assistantText) {
    await startStreamingRound(runtime, round.state, pending.pendingUserInput, pending.turn, false);
    return;
  }

  const completedResult: RuntimeTurnResult<State, ToolRequest, TrustTarget> = {
    kind: 'completed',
    assistantText,
    state: round.state,
    requestTrace: [...pending.turn.requestTrace],
    toolExecutions: [...pending.turn.toolExecutions],
    compactions: [...pending.turn.compactions],
  };

  if (!pending.streamEnded && !runtime.pendingAssistantTextStore.trim()) {
    runtime.pendingAssistantTextStore = assistantText;
    runtime.emitEvent({ kind: 'assistant-chunk', text: assistantText });
    runtime.historyStore.push({
      role: 'assistant',
      content: createLlmMessageContentFromText(assistantText),
    });
    runtime.pendingUserTurnStore = undefined;
    clearPendingStreamingState(runtime);
    if (runtime.loopEnabled()) {
      const continuationState = appendLoopContinuationGuidance(
        runtime,
        round.state,
        pending.pendingUserInput,
      );
      await startStreamingRound(runtime, continuationState, pending.pendingUserInput, pending.turn, true);
      return;
    }
    runtime.storeCompletedTurnResult(completedResult);
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    return;
  }

  if (pending.streamEnded) {
    clearPendingStreamingState(runtime);
    if (runtime.loopEnabled()) {
      const continuationState = appendLoopContinuationGuidance(
        runtime,
        round.state,
        pending.pendingUserInput,
      );
      await startStreamingRound(runtime, continuationState, pending.pendingUserInput, pending.turn, true);
      return;
    }
    runtime.storeCompletedTurnResult(completedResult);
  }
}

