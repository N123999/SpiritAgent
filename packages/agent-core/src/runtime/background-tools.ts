import type { LlmMessage, ToolCallRequest, ToolExecutionOutput } from '../ports.js';
import type { JsonObject } from '../ports.js';
import { createToolExecutionTextOutput } from '../ports.js';

import { renderError } from './helpers.js';
import { prepareAndSyncRuntimeToolResultToHistory } from './tool-output-append.js';
import { toolInputFromArgumentsJson } from '../hooks/integration.js';
import { runPostToolUseSideEffects } from '../hooks/tool-hooks.js';
import { commitToolExecutionOutput, type TurnMachineRuntime } from './turn-machine.js';
import type {
  AgentRuntimeOptions,
  DeferredBackgroundToolExecutionSpec,
  PendingEarlyToolExecution,
  PendingBackgroundToolExecution,
  PendingManualBackgroundToolExecution,
  PendingToolCallBackgroundToolExecution,
  RuntimeCompletedManualToolCommandResult,
  RuntimeEvent,
  RuntimeTurnContext,
} from './types.js';

export interface BackgroundToolsRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  pendingBackgroundToolStatusStore: string | undefined;
  pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  deferredBackgroundToolExecutions: DeferredBackgroundToolExecutionSpec<State, ToolRequest>[];
  completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  startToolAgentRoundAsync(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emptyAssistantRetries?: number,
  ): void;
  startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
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
  processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): Promise<void>;
  readOutstandingToolTurnFlags?: () => {
    hasPendingApproval: boolean;
    hasPendingContinuation: boolean;
    hasPendingQuestions: boolean;
    deferredBgCount: number;
  };
  advanceTurnToolState?: (
    turn: RuntimeTurnContext<ToolRequest>,
    state: State,
  ) => void;
  resolveTurnToolState?: (
    turn: RuntimeTurnContext<ToolRequest>,
    fallback: State,
  ) => State;
}

function hasOutstandingToolTurnWork<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
): boolean {
  const flags = runtime.readOutstandingToolTurnFlags?.();
  if (!flags) {
    return false;
  }
  return flags.hasPendingApproval
    || flags.hasPendingContinuation
    || flags.hasPendingQuestions
    || flags.deferredBgCount > 0;
}

/** persistAssistantToolCalls 只写 historyStore；续跑 LLM 须从 history 重建 state，避免 pending.state 缺 assistant tool_calls。 */
function buildBackgroundToolContinuationState<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
): State {
  return runtime.options.createContinuationState
    ? runtime.options.createContinuationState(runtime.historyStore)
    : runtime.options.createToolAgentState(runtime.historyStore, pendingUserInput);
}

export function startBackgroundToolExecutionAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  postHookToolInput?: JsonObject,
): void {
  const statusText = runtime.options.toolExecutor.backgroundStatusText?.(request);
  runtime.pendingBackgroundToolStatusStore = statusText;
  runtime.emitEvent({
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
    argumentsJson,
    startedAtUnixMs: Date.now(),
    ...(postHookToolInput ? { postHookToolInput } : {}),
    remainingCalls: [...remainingCalls],
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
    statusText,
    output: undefined,
    failed: undefined,
  };
  runtime.pendingBackgroundToolExecution = pending;

  const requestForExecution = runtime.options.toolExecutor.attachRequestMetadata?.(request, {
    toolCallId,
    toolName,
    onOutputChunk: (chunk) => {
      runtime.emitEvent({
        kind: 'tool-execution-output-chunk',
        toolCallId,
        toolName,
        request,
        chunk,
      });
    },
  }) ?? request;

  void runtime.options.toolExecutor
    .execute(requestForExecution)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = false;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = createToolExecutionTextOutput(`[tool error] ${renderError(error)}`);
        pending.failed = true;
      }
    });
}

export function scheduleBackgroundToolExecutionAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  argumentsJson: string,
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  postHookToolInput?: JsonObject,
): void {
  if (runtime.pendingBackgroundToolExecution !== undefined) {
    runtime.deferredBackgroundToolExecutions.push({
      pendingUserInput,
      request,
      toolCallId,
      toolName,
      argumentsJson,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
      ...(postHookToolInput ? { postHookToolInput } : {}),
    });
    return;
  }

  startBackgroundToolExecutionAsync(
    runtime,
    pendingUserInput,
    state,
    request,
    toolCallId,
    toolName,
    argumentsJson,
    [],
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    earlyToolExecutions,
    postHookToolInput,
  );
}

function startNextDeferredBackgroundToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  resumedState: State,
): void {
  const next = runtime.deferredBackgroundToolExecutions.shift();
  if (!next) {
    return;
  }

  startBackgroundToolExecutionAsync(
    runtime,
    next.pendingUserInput,
    resumedState,
    next.request,
    next.toolCallId,
    next.toolName,
    next.argumentsJson,
    [],
    next.turn,
    next.resumeAsStreaming,
    next.streamingEmitBeginResponse,
    next.earlyToolExecutions,
    next.postHookToolInput,
  );
}

export function startManualBackgroundToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  request: ToolRequest,
  toolName: string,
): string | undefined {
  const statusText = runtime.options.toolExecutor.backgroundStatusText?.(request);
  runtime.pendingBackgroundToolStatusStore = statusText;
  runtime.emitEvent({
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
  runtime.pendingBackgroundToolExecution = pending;

  const requestForExecution = runtime.options.toolExecutor.attachRequestMetadata?.(request, {
    toolName,
    onOutputChunk: (chunk) => {
      runtime.emitEvent({
        kind: 'tool-execution-output-chunk',
        toolCallId: `manual:${toolName}`,
        toolName,
        request,
        chunk,
      });
    },
  }) ?? request;

  void runtime.options.toolExecutor
    .execute(requestForExecution)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = false;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = createToolExecutionTextOutput(`[tool error] ${renderError(error)}`);
        pending.failed = true;
      }
    });

  return statusText;
}

export async function pollPendingBackgroundToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: BackgroundToolsRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<void> {
  const pending = runtime.pendingBackgroundToolExecution;
  if (!pending || pending.output === undefined || pending.failed === undefined) {
    return;
  }

  runtime.pendingBackgroundToolExecution = undefined;
  runtime.pendingBackgroundToolStatusStore = undefined;
  runtime.emitEvent({
    kind: 'background-tool-status',
    phase: 'finished',
    toolName: pending.toolName,
    request: pending.request,
    ...(pending.statusText !== undefined ? { statusText: pending.statusText } : {}),
    failed: pending.failed,
  });

  if (pending.kind === 'manual') {
    runtime.completedManualToolCommandResultStore = {
      kind: 'completed',
      request: pending.request,
      toolName: pending.toolName,
      output: pending.output.summaryText,
      failed: pending.failed,
      backgroundExecution: true,
    };
    return;
  }

  commitToolExecutionOutput(runtime, pending.turn, {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    output: pending.output,
    failed: pending.failed,
  });
  await runPostToolUseSideEffects(
    runtime as unknown as TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    {
      id: pending.toolCallId,
      name: pending.toolName,
      argumentsJson: pending.argumentsJson,
    },
    pending.postHookToolInput ?? toolInputFromArgumentsJson(pending.argumentsJson),
    pending.output,
    Math.max(0, Date.now() - pending.startedAtUnixMs),
    pending.failed,
  );

  await prepareAndSyncRuntimeToolResultToHistory(
    runtime,
    pending.toolCallId,
    pending.output.summaryText,
  );
  const continuationState = buildBackgroundToolContinuationState(
    runtime,
    pending.pendingUserInput,
  );
  runtime.advanceTurnToolState?.(pending.turn, continuationState);
  if (runtime.deferredBackgroundToolExecutions.length > 0) {
    startNextDeferredBackgroundToolExecution(runtime, continuationState);
    return;
  }
  if (pending.remainingCalls.length > 0) {
    runtime.queuePendingToolCallContinuation(
      continuationState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
      pending.resumeAsStreaming,
      pending.streamingEmitBeginResponse,
      pending.earlyToolExecutions,
    );
    return;
  }

  if (hasOutstandingToolTurnWork(runtime)) {
    return;
  }

  if (pending.resumeAsStreaming) {
    await runtime.startStreamingRound(
      continuationState,
      pending.pendingUserInput,
      pending.turn,
      pending.streamingEmitBeginResponse,
    );
    return;
  }

  runtime.startToolAgentRoundAsync(continuationState, pending.pendingUserInput, pending.turn);
}
