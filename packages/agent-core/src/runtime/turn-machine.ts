import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  AuthorizationDecision,
  JsonValue,
  LlmMessage,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from '../ports.js';

import { renderError } from './helpers.js';
import { formatUserMessageContentForLlm } from './user-turn-timestamp.js';
import type { ToolExecutionResult } from './tool-execution.js';
import type {
  AgentRuntimeOptions,
  PendingApprovalState,
  PendingToolAgentRound,
  RuntimeApprovalDecision,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimePendingApproval,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from './types.js';

export interface TurnMachineRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  requestTraceStore: JsonValue[];
  pendingUserTurnStore: string | undefined;
  pendingApproval: PendingApprovalState<State, ToolRequest, TrustTarget> | undefined;
  pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void;
  clearStreamingUiState(): void;
  completeTurn(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  performToolExecution(
    request: ToolRequest,
    toolName: string,
  ): Promise<ToolExecutionResult>;
  startBackgroundToolExecutionAsync(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): void;
  startHistoryCompactionAsync(
    retryState: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    originalError: string,
    toolTruncationApplied: boolean,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ): void;
  startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void>;
  takeCompletedTurnResult(): RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined;
  tryFallbackToTextOnlyAndBuildRetryState(error: string, pendingUserInput: string): State | undefined;
  compactHistoryImmediate(): Promise<RuntimeCompactionRecord>;
  isBusy(): boolean;
  poll(): Promise<void>;
}

export async function resumePendingApproval<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  decision: RuntimeApprovalDecision,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  const pending = runtime.pendingApproval;
  if (!pending) {
    throw new Error('当前没有待确认的工具调用。');
  }

  runtime.pendingApproval = undefined;

  if (decision.kind === 'allow') {
    if (decision.persistTrust && pending.trustTarget !== undefined) {
      await runtime.options.toolExecutor.trust(pending.trustTarget);
    }

    return executeAuthorizedToolCall(
      runtime,
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
    let resumedState = runtime.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      guidanceText,
    );

    if (!guidanceMessage) {
      return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
    }

    const guidanceForLlm = formatUserMessageContentForLlm(guidanceMessage);
    runtime.historyStore.push({
      role: 'user',
      content: guidanceForLlm,
      imagePaths: [],
    });
    runtime.pendingUserTurnStore = guidanceMessage;
    resumedState = runtime.options.appendUserMessage
      ? runtime.options.appendUserMessage(resumedState, guidanceForLlm)
      : runtime.options.createToolAgentState(runtime.historyStore, guidanceMessage);

    return runTurnLoop(runtime, resumedState, guidanceMessage, pending.turn);
  }

  const deniedText = decision.resultText?.trim()
    ? decision.resultText
    : '[denied by user] tool call rejected by user approval policy';
  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    deniedText,
  );

  return processToolCalls(
    runtime,
    resumedState,
    pending.pendingUserInput,
    pending.remainingCalls,
    pending.turn,
  );
}

export async function runTurnLoop<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  let currentState = state;
  let emptyAssistantRetries = 0;

  while (true) {
    const completion = await runtime.options.llmTransport.startToolAgentRound(
      runtime.options.config,
      currentState,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    );

    if (completion.kind === 'failure') {
      runtime.appendTrace(completion.requestTrace, turn);

      const textOnlyRetryState = runtime.tryFallbackToTextOnlyAndBuildRetryState(
        completion.error,
        pendingUserInput,
      );
      if (textOnlyRetryState !== undefined) {
        currentState = textOnlyRetryState;
        continue;
      }

      if (
        runtime.options.llmTransport.isContextOverflowError(completion.error) &&
        turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
      ) {
        turn.autoCompactAttempts += 1;
        const preparedRetry = runtime.options.truncateStateForContextRetry
          ? runtime.options.truncateStateForContextRetry(currentState)
          : { state: currentState, changed: false };

        try {
          const compaction = await runtime.compactHistoryImmediate();
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
              : runtime.options.rebuildRetryStateAfterCompaction
                ? runtime.options.rebuildRetryStateAfterCompaction(
                    runtime.historyStore,
                    pendingUserInput,
                    preparedRetry.state,
                  )
                : runtime.options.createToolAgentState(runtime.historyStore, pendingUserInput);
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
    runtime.appendTrace(round.requestTrace, turn);
    currentState = round.state;

    if (round.step.kind === 'tool-calls') {
      return processToolCalls(runtime, currentState, pendingUserInput, round.step.calls, turn);
    }

    const assistantText = runtime.options.extractAssistantText(currentState)?.trim();
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

    runtime.historyStore.push({
      role: 'assistant',
      content: assistantText,
      imagePaths: [],
    });
    runtime.pendingUserTurnStore = undefined;

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

export async function processToolCalls<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
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
      request = await runtime.options.toolExecutor.requestFromFunctionCall(
        call.name,
        call.argumentsJson,
      );
      request = runtime.options.toolExecutor.attachRequestMetadata?.(request, {
        toolCallId: call.id,
        toolName: call.name,
      }) ?? request;
    } catch (error) {
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[tool schema error] ${renderError(error)}`,
      );
      continue;
    }

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await runtime.options.toolExecutor.authorize(request);
    } catch (error) {
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[authorization error] ${renderError(error)}`,
      );
      continue;
    }

    if (authorization.kind === 'need-approval') {
      const approval = createApproval(
        authorization.prompt,
        request,
        call.id,
        call.name,
        authorization.trustTarget,
      );
      runtime.pendingApproval = {
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
        resumeAsStreaming: false,
        streamingEmitBeginResponse: true,
      };
      runtime.emitEvent({
        kind: 'approval-requested',
        approval,
      });

      return {
        kind: 'requires-approval',
        approval,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }

    return executeAuthorizedToolCall(
      runtime,
      pendingUserInput,
      currentState,
      request,
      call.id,
      call.name,
      remaining,
      turn,
    );
  }

  return runTurnLoop(runtime, currentState, pendingUserInput, turn);
}

export async function executeAuthorizedToolCall<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
  state: State,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  const execution = await runtime.performToolExecution(request, toolName);

  turn.toolExecutions.push({
    toolCallId,
    toolName,
    request,
    output: execution.output,
    failed: execution.failed,
  });

  const resumedState = runtime.options.appendToolResultMessage(state, toolCallId, execution.output);
  if (remainingCalls.length > 0) {
    return processToolCalls(runtime, resumedState, pendingUserInput, remainingCalls, turn);
  }

  return runTurnLoop(runtime, resumedState, pendingUserInput, turn);
}

export function startToolAgentRoundAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
  emptyAssistantRetries = 0,
): void {
  runtime.clearStreamingUiState();

  const pending: PendingToolAgentRound<State, ToolRequest> = {
    pendingUserInput,
    state,
    turn,
    completion: undefined,
    completionHandled: false,
    emptyAssistantRetries,
  };
  runtime.pendingToolAgentRound = pending;

  void runtime.options.llmTransport
    .startToolAgentRound(
      runtime.options.config,
      state,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    )
    .then((completion) => {
      if (runtime.pendingToolAgentRound === pending) {
        pending.completion = completion;
      }
    })
    .catch((error: unknown) => {
      if (runtime.pendingToolAgentRound === pending) {
        pending.completion = {
          kind: 'failure',
          error: renderError(error),
          requestTrace: [],
        };
      }
    });
}

export async function pollPendingToolAgentRound<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<void> {
  const pending = runtime.pendingToolAgentRound;
  if (!pending || pending.completionHandled || !pending.completion) {
    return;
  }

  pending.completionHandled = true;
  runtime.pendingToolAgentRound = undefined;
  await handlePendingToolAgentRoundCompletion(runtime, pending, pending.completion);
}

export async function handlePendingToolAgentRoundCompletion<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  pending: PendingToolAgentRound<State, ToolRequest>,
  completion: ToolAgentRoundCompletion<State>,
): Promise<void> {
  if (completion.kind === 'failure') {
    runtime.appendTrace(completion.requestTrace, pending.turn);

    const textOnlyRetryState = runtime.tryFallbackToTextOnlyAndBuildRetryState(
      completion.error,
      pending.pendingUserInput,
    );
    if (textOnlyRetryState !== undefined) {
      startToolAgentRoundAsync(runtime, textOnlyRetryState, pending.pendingUserInput, pending.turn);
      return;
    }

    if (
      runtime.options.llmTransport.isContextOverflowError(completion.error) &&
      pending.turn.autoCompactAttempts < (runtime.options.maxAutoCompactRetries ?? 1)
    ) {
      pending.turn.autoCompactAttempts += 1;
      const preparedRetry = runtime.options.truncateStateForContextRetry
        ? runtime.options.truncateStateForContextRetry(pending.state)
        : { state: pending.state, changed: false };
      runtime.startHistoryCompactionAsync(
        preparedRetry.state,
        pending.pendingUserInput,
        pending.turn,
        completion.error,
        preparedRetry.changed,
      );
      return;
    }

    runtime.completeTurn({
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
  runtime.appendTrace(round.requestTrace, pending.turn);

  if (round.step.kind === 'tool-calls') {
    await processToolCallsAsync(
      runtime,
      round.state,
      pending.pendingUserInput,
      round.step.calls,
      pending.turn,
    );
    return;
  }

  const assistantText = runtime.options.extractAssistantText(round.state)?.trim();
  if (!assistantText) {
    if (pending.emptyAssistantRetries >= 1) {
      runtime.completeTurn({
        kind: 'failed',
        error: '模型返回了 final-response-ready，但没有可用的 assistant 正文。',
        state: round.state,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
      return;
    }

    startToolAgentRoundAsync(
      runtime,
      round.state,
      pending.pendingUserInput,
      pending.turn,
      pending.emptyAssistantRetries + 1,
    );
    return;
  }

  runtime.historyStore.push({
    role: 'assistant',
    content: assistantText,
    imagePaths: [],
  });
  runtime.pendingUserTurnStore = undefined;
  runtime.completeTurn({
    kind: 'completed',
    assistantText,
    state: round.state,
    requestTrace: [...pending.turn.requestTrace],
    toolExecutions: [...pending.turn.toolExecutions],
    compactions: [...pending.turn.compactions],
  });
}

export async function processToolCallsAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
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
      request = await runtime.options.toolExecutor.requestFromFunctionCall(
        call.name,
        call.argumentsJson,
      );
      request = runtime.options.toolExecutor.attachRequestMetadata?.(request, {
        toolCallId: call.id,
        toolName: call.name,
      }) ?? request;
    } catch (error) {
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[tool schema error] ${renderError(error)}`,
      );
      continue;
    }

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await runtime.options.toolExecutor.authorize(request);
    } catch (error) {
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[authorization error] ${renderError(error)}`,
      );
      continue;
    }

    if (authorization.kind === 'need-approval') {
      const approval = createApproval(
        authorization.prompt,
        request,
        call.id,
        call.name,
        authorization.trustTarget,
      );
      runtime.pendingApproval = {
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
        resumeAsStreaming,
        streamingEmitBeginResponse,
      };

      if (resumeAsStreaming) {
        runtime.emitEvent({
          kind: 'approval-requested',
          approval,
        });
      } else {
        runtime.completeTurn({
          kind: 'requires-approval',
          approval,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        });
      }
      return;
    }

    if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
      runtime.startBackgroundToolExecutionAsync(
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

    const execution = await runtime.performToolExecution(request, call.name);
    turn.toolExecutions.push({
      toolCallId: call.id,
      toolName: call.name,
      request,
      output: execution.output,
      failed: execution.failed,
    });
    currentState = runtime.options.appendToolResultMessage(currentState, call.id, execution.output);
  }

  if (resumeAsStreaming) {
    await runtime.startStreamingRound(
      currentState,
      pendingUserInput,
      turn,
      streamingEmitBeginResponse,
    );
    return;
  }

  startToolAgentRoundAsync(runtime, currentState, pendingUserInput, turn);
}

export async function waitForCompletedTurnResult<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  while (true) {
    const existing = runtime.takeCompletedTurnResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出结果时提前进入空闲状态。');
    }

    await runtime.poll();

    const result = runtime.takeCompletedTurnResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出结果时提前进入空闲状态。');
    }

    await waitForImmediate();
  }
}

function createApproval<ToolRequest, TrustTarget>(
  prompt: string,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  trustTarget: TrustTarget | undefined,
): RuntimePendingApproval<ToolRequest, TrustTarget> {
  return {
    prompt,
    request,
    ...(trustTarget !== undefined ? { trustTarget } : {}),
    toolCallId,
    toolName,
  };
}