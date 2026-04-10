import type { ToolCallRequest } from '../ports.js';

import { renderError } from './helpers.js';
import type {
  AgentRuntimeOptions,
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
  pendingBackgroundToolStatusStore: string | undefined;
  pendingBackgroundToolExecution:
    | PendingBackgroundToolExecution<State, ToolRequest>
    | undefined;
  completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  persistToolExecutionMemory(request: ToolRequest, output: string): void;
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
  processToolCallsAsync(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): Promise<void>;
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
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
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
    remainingCalls: [...remainingCalls],
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    statusText,
    output: undefined,
    failed: undefined,
  };
  runtime.pendingBackgroundToolExecution = pending;

  void runtime.options.toolExecutor
    .execute(request)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = false;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = `[tool error] ${renderError(error)}`;
        pending.failed = true;
      }
    });
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

  void runtime.options.toolExecutor
    .execute(request)
    .then((output) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = output;
        pending.failed = false;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingBackgroundToolExecution === pending) {
        pending.output = `[tool error] ${renderError(error)}`;
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

  runtime.persistToolExecutionMemory(pending.request, pending.output);
  if (pending.kind === 'manual') {
    runtime.completedManualToolCommandResultStore = {
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

  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    pending.output,
  );
  if (pending.remainingCalls.length > 0) {
    await runtime.processToolCallsAsync(
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
    await runtime.startStreamingRound(
      resumedState,
      pending.pendingUserInput,
      pending.turn,
      pending.streamingEmitBeginResponse,
    );
    return;
  }

  runtime.startToolAgentRoundAsync(resumedState, pending.pendingUserInput, pending.turn);
}