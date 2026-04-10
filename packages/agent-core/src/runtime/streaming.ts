import type { LlmMessage, LlmStreamEvent, ToolAgentRoundCompletion } from '../ports.js';

import { STREAM_EVENT_BUDGET_PER_POLL, STREAM_STALL_TIMEOUT_MS } from './constants.js';
import { cloneHistory, renderError } from './helpers.js';
import type {
  AgentRuntimeOptions,
  AssistantAuxKind,
  PendingBackgroundToolExecution,
  PendingHistoryCompaction,
  PendingStreamingRound,
  PendingToolAgentRound,
  RuntimeEvent,
  RuntimeTurnContext,
} from './types.js';

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
  compactionTextStore: string;
  pendingStartedAtStore: number | undefined;
  pendingLastEventAtStore: number | undefined;
  streamChunkCounterStore: number;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  appendTrace(trace: unknown[], turn: RuntimeTurnContext<ToolRequest>): void;
  tryFallbackToTextOnlyAndBuildRetryState(error: string, pendingUserInput: string): State | undefined;
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
    calls: import('../ports.js').ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): Promise<void>;
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
  clearPendingStreamingState(runtime);
  runtime.pendingStartedAtStore = Date.now();
  runtime.pendingLastEventAtStore = runtime.pendingStartedAtStore;

  const pending: PendingStreamingRound<State, ToolRequest> = {
    pendingUserInput,
    turn,
    rawEvents: [],
    completion: undefined,
    completionHandled: false,
    streamEnded: false,
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

export function clearStreamingUiState<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
): void {
  runtime.pendingStartedAtStore = undefined;
  runtime.pendingLastEventAtStore = undefined;
  runtime.streamChunkCounterStore = 0;
  runtime.pendingAssistantTextStore = '';
  runtime.thinkingTextStore = '';
  runtime.compactionTextStore = '';
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

  if (event.kind === 'tool-progress') {
    mergeToolProgressIntoThinking(runtime, event.text);
    runtime.emitEvent({
      kind: 'update-pending-assistant-thinking',
      text: runtime.thinkingTextStore,
    });
    return false;
  }

  if (event.kind === 'assistant-chunk') {
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
    if (!runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({ kind: 'remove-pending-assistant' });
    } else {
      runtime.historyStore.push({
        role: 'assistant',
        content: runtime.pendingAssistantTextStore,
        imagePaths: [],
      });
      runtime.pendingUserTurnStore = undefined;
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    }

    clearStreamingUiState(runtime);
    return true;
  }

  const retryState = runtime.tryFallbackToTextOnlyAndBuildRetryState(
    event.error,
    pending.pendingUserInput,
  );
  if (retryState !== undefined) {
    if (!runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: '当前模型不支持图片输入，已自动去除图片并重试。',
      });
    }
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    await startStreamingRound(runtime, retryState, pending.pendingUserInput, pending.turn, true);
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

    const textOnlyRetryState = runtime.tryFallbackToTextOnlyAndBuildRetryState(
      completion.error,
      pending.pendingUserInput,
    );
    if (textOnlyRetryState !== undefined) {
      await startStreamingRound(runtime, textOnlyRetryState, pending.pendingUserInput, pending.turn, true);
      return;
    }

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
    clearPendingStreamingState(runtime);
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    return;
  }

  const round = completion.result;
  runtime.appendTrace(round.requestTrace, pending.turn);

  if (round.step.kind === 'tool-calls') {
    if (!pending.streamEnded && !runtime.pendingAssistantTextStore.trim()) {
      runtime.emitEvent({ kind: 'remove-pending-assistant' });
    }
    clearPendingStreamingState(runtime);
    await runtime.processToolCallsAsync(
      round.state,
      pending.pendingUserInput,
      round.step.calls,
      pending.turn,
      true,
      true,
    );
    return;
  }

  const assistantText = runtime.options.extractAssistantText(round.state)?.trim();
  if (!assistantText) {
    await startStreamingRound(runtime, round.state, pending.pendingUserInput, pending.turn, false);
    return;
  }

  if (!pending.streamEnded && !runtime.pendingAssistantTextStore.trim()) {
    runtime.pendingAssistantTextStore = assistantText;
    runtime.emitEvent({ kind: 'assistant-chunk', text: assistantText });
    runtime.historyStore.push({
      role: 'assistant',
      content: assistantText,
      imagePaths: [],
    });
    runtime.pendingUserTurnStore = undefined;
    clearPendingStreamingState(runtime);
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    return;
  }

  if (pending.streamEnded) {
    clearPendingStreamingState(runtime);
  }
}

export function mergeToolProgressIntoThinking<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: StreamingRuntime<Config, State, ToolRequest, TrustTarget>,
  progress: string,
): void {
  const normalized = progress.trim();
  if (!normalized) {
    return;
  }

  if (!runtime.thinkingTextStore.trim()) {
    runtime.thinkingTextStore = normalized;
    return;
  }

  if (runtime.thinkingTextStore.split('\n').some((line) => line.trim() === normalized)) {
    return;
  }

  if (!runtime.thinkingTextStore.endsWith('\n')) {
    runtime.thinkingTextStore += '\n';
  }
  runtime.thinkingTextStore += normalized;
}