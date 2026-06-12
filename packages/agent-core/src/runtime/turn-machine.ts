import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type {
  AskQuestionsResult,
  AuthorizationDecision,
  JsonObject,
  JsonValue,
  LlmMessage,
  ToolExecutionOutput,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from '../ports.js';
import {
  cloneLlmMessageContent,
  cloneLlmProviderState,
  createLlmMessageContentFromText,
} from '../ports.js';
import { emitContextUsageUpdated } from './context-usage.js';
import { isOpenResponsesTransportConfig } from '../provider-config.js';
import {
  buildApplyPatchToolResultProviderState,
  registerPendingApplyPatchCallIds,
} from '../open-responses/apply-patch-bridge.js';
import { APPLY_PATCH_HOST_TOOL_NAME } from '../open-responses/apply-patch-eligibility.js';
import {
  hookDeniedToolOutput,
  runPostToolUseSideEffects,
  runPreToolUseGate,
} from '../hooks/tool-hooks.js';
import { toolInputFromArgumentsJson } from '../hooks/integration.js';
import { appendToolResultMessages, isJsonObject } from '../tool-agent.js';
import { buildEarlyExecutableArgumentsJson } from '../tool-streaming-preview-gate.js';
import {
  applyDeferredUserGuidance,
  appendLoopContinuationGuidance,
  enqueueDeferredToolOutputGuidance,
  enqueueDeferredUserGuidance,
  isCompatibleContinuedToolRequest,
  renderError,
  toolArtifactsFromOutput,
} from './helpers.js';
import type { ToolExecutionResult } from './tool-execution.js';
import type {
  AgentRuntimeOptions,
  PendingEarlyToolExecution,
  PendingEarlyToolExecutionOutcome,
  PendingApprovalState,
  PendingQuestionsState,
  PendingToolAgentRound,
  RuntimeApprovalDecision,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
  RuntimeToolExecution,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from './types.js';

export type EarlyInternalToolCallResult =
  | {
      kind: 'completed';
      output: ToolExecutionOutput;
      failed: boolean;
      enqueueDeferredGuidance?: boolean;
      fatalError?: string;
    }
  | { kind: 'defer-to-formal' };

export interface InternalToolCallRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  maybeExecuteInternalToolCall?: (
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ) => Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined>;
  maybeContinueInternalToolCallAsync?: (
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
  ) => Promise<boolean>;
  tryPerformEarlyInternalToolCall?: (
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
  ) => Promise<EarlyInternalToolCallResult | undefined>;
}

export interface TurnMachineRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> extends InternalToolCallRuntime<Config, State, ToolRequest, TrustTarget> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  requestTraceStore: JsonValue[];
  pendingUserTurnStore: string | undefined;
  pendingApproval: PendingApprovalState<State, ToolRequest, TrustTarget> | undefined;
  pendingQuestions: PendingQuestionsState<State, ToolRequest> | undefined;
  pendingToolAgentRound: PendingToolAgentRound<State, ToolRequest> | undefined;
  appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void;
  clearStreamingUiState(): void;
  completeTurn(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  recordContextMessage?(role: 'system' | 'user' | 'assistant', content: string): void;
  performToolExecution(
    request: ToolRequest,
    toolName: string,
    toolCallId?: string,
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
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
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
  queuePendingToolCallContinuation(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
    resumeAsStreaming?: boolean,
    streamingEmitBeginResponse?: boolean,
    earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
  ): void;
  takeCompletedTurnResult(): RuntimeTurnResult<State, ToolRequest, TrustTarget> | undefined;
  compactHistoryImmediate(): Promise<RuntimeCompactionRecord>;
  loopEnabled(): boolean;
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
  runtime.emitEvent({
    kind: 'approval-resolved',
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    decisionKind: decision.kind,
  });

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
    commitSyntheticToolExecutionFailure(
      runtime,
      pending.turn,
      pending.request,
      pending.toolCallId,
      pending.toolName,
      guidanceText,
    );
    let resumedState = runtime.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      guidanceText,
    );

    if (!guidanceMessage) {
      return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
    }

    enqueueDeferredUserGuidance(pending.turn, guidanceMessage);
    if (pending.remainingCalls.length > 0) {
      return processToolCalls(
        runtime,
        resumedState,
        pending.pendingUserInput,
        pending.remainingCalls,
        pending.turn,
      );
    }

    return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
  }

  const deniedText = decision.resultText?.trim()
    ? decision.resultText
    : '[denied by user] tool call rejected by user approval policy';
  commitSyntheticToolExecutionFailure(
    runtime,
    pending.turn,
    pending.request,
    pending.toolCallId,
    pending.toolName,
    deniedText,
  );
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

export async function resumePendingQuestions<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  result: AskQuestionsResult,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  const pending = runtime.pendingQuestions;
  if (!pending) {
    throw new Error('当前没有待回答的问题表单。');
  }

  runtime.pendingQuestions = undefined;
  const continuedRequest = runtime.options.toolExecutor.continueAfterQuestions
    ? await runtime.options.toolExecutor.continueAfterQuestions(pending.request, result)
    : undefined;

  if (continuedRequest !== undefined) {
    if (!isCompatibleContinuedToolRequest(pending.request, continuedRequest)) {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        pending.request,
        '[continueAfterQuestions error] continued request must stay on the same tool.',
      );
    }

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await runtime.options.toolExecutor.authorize(continuedRequest);
    } catch (error) {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        continuedRequest,
        `[authorization error] ${renderError(error)}`,
      );
    }

    if (authorization.kind === 'need-approval') {
      const approval = createApproval(
        authorization.prompt,
        continuedRequest,
        pending.toolCallId,
        pending.toolName,
        authorization.trustTarget,
      );
      runtime.pendingApproval = {
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
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      };
    }

    if (authorization.kind === 'need-questions') {
      return continueAfterQuestionsFailure(
        runtime,
        pending,
        continuedRequest,
        '[continueAfterQuestions error] continued request cannot require questions again.',
      );
    }

    return executeAuthorizedToolCall(
      runtime,
      pending.pendingUserInput,
      pending.state,
      continuedRequest,
      pending.toolCallId,
      pending.toolName,
      pending.remainingCalls,
      pending.turn,
    );
  }

  const output = JSON.stringify(result);
  const questionsExecution: RuntimeToolExecution<ToolRequest> = {
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    request: pending.request,
    output,
    failed: false,
  };
  pending.turn.toolExecutions.push(questionsExecution);
  runtime.emitEvent({
    kind: 'tool-execution-finished',
    execution: questionsExecution,
  });

  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    output,
  );

  if (pending.remainingCalls.length > 0) {
    return processToolCalls(
      runtime,
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
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
  let currentPendingUserInput = pendingUserInput;
  let currentState = state;
  ({ state: currentState, pendingUserInput: currentPendingUserInput } = applyDeferredUserGuidance(
    runtime,
    currentState,
    currentPendingUserInput,
    turn,
  ));
  let emptyAssistantRetries = 0;

  while (true) {
    const completion = await runtime.options.llmTransport.startToolAgentRound(
      runtime.options.config,
      currentState,
      runtime.options.toolExecutor.toolDefinitionsJson(),
    );

    if (completion.kind === 'failure') {
      runtime.appendTrace(completion.requestTrace, turn);

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
                    currentPendingUserInput,
                    preparedRetry.state,
                  )
                : runtime.options.createToolAgentState(runtime.historyStore, currentPendingUserInput);
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
      return processToolCalls(runtime, currentState, currentPendingUserInput, round.step.calls, turn);
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
      content: createLlmMessageContentFromText(assistantText),
    });
    if (runtime.loopEnabled()) {
      currentState = appendLoopContinuationGuidance(runtime, currentState, currentPendingUserInput);
      emptyAssistantRetries = 0;
      continue;
    }
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

  persistAssistantToolCalls(runtime, state, calls);

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

      const preGate = await runPreToolUseGate(runtime, call, request);
      if (preGate.kind === 'denied') {
        const output = `[hook denied] ${hookDeniedToolOutput(preGate.error)}`;
        commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
        currentState = runtime.options.appendToolResultMessage(
          currentState,
          call.id,
          output,
        );
        continue;
      }
      request = preGate.request;

      runtime.emitEvent({
        kind: 'tool-call-started',
        toolCallId: call.id,
        toolName: call.name,
        request,
      });
    } catch (error) {
      commitToolCallSchemaError(runtime, turn, call, error);
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
      const output = `[authorization error] ${renderError(error)}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        output,
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

    if (authorization.kind === 'need-questions') {
      const questions = createQuestions(request, call.id, call.name, authorization.questions);
      runtime.pendingQuestions = {
        pendingUserInput,
        state: currentState,
        request,
        questions: authorization.questions,
        toolCallId: call.id,
        toolName: call.name,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming: false,
        streamingEmitBeginResponse: true,
      };
      runtime.emitEvent({
        kind: 'questions-requested',
        questions,
      });

      return {
        kind: 'requires-questions',
        questions,
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
      call.argumentsJson,
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
  toolArgumentsJson = '{}',
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  const internal = await runtime.maybeExecuteInternalToolCall?.(
    pendingUserInput,
    state,
    request,
    toolCallId,
    toolName,
    remainingCalls,
    turn,
  );
  if (internal) {
    return internal;
  }

  const startedAt = Date.now();
  const execution = await runtime.performToolExecution(request, toolName, toolCallId);
  commitToolExecutionOutput(runtime, turn, {
    toolCallId,
    toolName,
    request,
    output: execution.output,
    failed: execution.failed,
  });
  await runPostToolUseSideEffects(
    runtime,
    { id: toolCallId, name: toolName, argumentsJson: toolArgumentsJson },
    toolInputFromArgumentsJson(toolArgumentsJson),
    execution.output,
    Date.now() - startedAt,
    execution.failed,
  );
  const resumedState = appendToolResultForRound(
    runtime,
    state,
    toolCallId,
    toolName,
    execution.output.summaryText,
    execution.failed,
  );
  if (remainingCalls.length > 0) {
    return processToolCalls(runtime, resumedState, pendingUserInput, remainingCalls, turn);
  }

  return runTurnLoop(runtime, resumedState, pendingUserInput, turn);
}

function appendToolResultForRound<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  toolCallId: string,
  toolName: string,
  content: string,
  failed = false,
): State {
  if (
    toolName === APPLY_PATCH_HOST_TOOL_NAME
    && isOpenResponsesTransportConfig(runtime.options.config as any)
  ) {
    registerPendingApplyPatchCallIds([toolCallId]);
    return appendToolResultMessages(state as any, [
      {
        toolCallId,
        content,
        providerState: buildApplyPatchToolResultProviderState(
          toolCallId,
          failed ? 'failed' : 'completed',
          failed ? content : undefined,
        ),
      },
    ]) as State;
  }

  return runtime.options.appendToolResultMessage(state, toolCallId, content);
}

async function continueAfterQuestionsFailure<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  pending: PendingQuestionsState<State, ToolRequest>,
  request: ToolRequest,
  output: string,
): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
  commitSyntheticToolExecutionFailure(
    runtime,
    pending.turn,
    request,
    pending.toolCallId,
    pending.toolName,
    output,
  );
  const resumedState = runtime.options.appendToolResultMessage(
    pending.state,
    pending.toolCallId,
    output,
  );

  if (pending.remainingCalls.length > 0) {
    return processToolCalls(
      runtime,
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  return runTurnLoop(runtime, resumedState, pending.pendingUserInput, pending.turn);
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
  ({ state, pendingUserInput } = applyDeferredUserGuidance(
    runtime,
    state,
    pendingUserInput,
    turn,
  ));
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
  emitContextUsageUpdated(runtime.emitEvent.bind(runtime), round.usage);

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
      content: createLlmMessageContentFromText(assistantText),
  });
  if (runtime.loopEnabled()) {
    const continuationState = appendLoopContinuationGuidance(
      runtime,
      round.state,
      pending.pendingUserInput,
    );
    startToolAgentRoundAsync(
      runtime,
      continuationState,
      pending.pendingUserInput,
      pending.turn,
    );
    return;
  }
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
  earlyToolExecutions?: Map<string, PendingEarlyToolExecution<ToolRequest>>,
): Promise<void> {
  let currentState = state;
  const remaining = [...calls];

  persistAssistantToolCalls(runtime, state, calls);

  while (remaining.length > 0) {
    const call = remaining.shift();
    if (!call) {
      break;
    }

    const earlyOutcome = await matchingEarlyToolExecutionOutcome(call, earlyToolExecutions);
    if (earlyOutcome?.kind === 'completed') {
      commitPreparedToolExecution(
        runtime,
        turn,
        earlyOutcome.execution,
        earlyOutcome.output,
        false,
        earlyOutcome.enqueueDeferredGuidance,
      );
      persistCompletedEarlyToolResult(runtime, call.id, earlyOutcome.output);
      if (earlyOutcome.fatalError !== undefined) {
        runtime.completeTurn({
          kind: 'failed',
          error: earlyOutcome.fatalError,
          state: currentState,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        });
        return;
      }
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        earlyOutcome.output.summaryText,
      );
      if (queueRemainingToolCallsAsync(
        runtime,
        currentState,
        pendingUserInput,
        remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        earlyToolExecutions,
      )) {
        return;
      }
      continue;
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

      const preGate = await runPreToolUseGate(runtime, call, request);
      if (preGate.kind === 'denied') {
        const output = `[hook denied] ${hookDeniedToolOutput(preGate.error)}`;
        commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
        currentState = runtime.options.appendToolResultMessage(
          currentState,
          call.id,
          output,
        );
        if (queueRemainingToolCallsAsync(
          runtime,
          currentState,
          pendingUserInput,
          remaining,
          turn,
          resumeAsStreaming,
          streamingEmitBeginResponse,
          earlyToolExecutions,
        )) {
          return;
        }
        continue;
      }
      request = preGate.request;

      runtime.emitEvent({
        kind: 'tool-call-started',
        toolCallId: call.id,
        toolName: call.name,
        request,
      });
    } catch (error) {
      commitToolCallSchemaError(runtime, turn, call, error);
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        `[tool schema error] ${renderError(error)}`,
      );
      if (queueRemainingToolCallsAsync(
        runtime,
        currentState,
        pendingUserInput,
        remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        earlyToolExecutions,
      )) {
        return;
      }
      continue;
    }

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await runtime.options.toolExecutor.authorize(request);
    } catch (error) {
      const output = `[authorization error] ${renderError(error)}`;
      commitSyntheticToolExecutionFailure(runtime, turn, request, call.id, call.name, output);
      currentState = runtime.options.appendToolResultMessage(
        currentState,
        call.id,
        output,
      );
      if (queueRemainingToolCallsAsync(
        runtime,
        currentState,
        pendingUserInput,
        remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        earlyToolExecutions,
      )) {
        return;
      }
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
        ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
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

    if (authorization.kind === 'need-questions') {
      const questions = createQuestions(request, call.id, call.name, authorization.questions);
      runtime.pendingQuestions = {
        pendingUserInput,
        state: currentState,
        request,
        questions: authorization.questions,
        toolCallId: call.id,
        toolName: call.name,
        remainingCalls: remaining,
        turn,
        resumeAsStreaming,
        streamingEmitBeginResponse,
        ...(earlyToolExecutions ? { earlyToolExecutions } : {}),
      };

      if (resumeAsStreaming) {
        runtime.emitEvent({
          kind: 'questions-requested',
          questions,
        });
      } else {
        runtime.completeTurn({
          kind: 'requires-questions',
          questions,
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
        earlyToolExecutions,
      );
      return;
    }

    const internalHandled = await runtime.maybeContinueInternalToolCallAsync?.(
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
    if (internalHandled) {
      return;
    }

    const startedAt = Date.now();
    const execution = await runtime.performToolExecution(request, call.name, call.id);
    commitToolExecutionOutput(runtime, turn, {
      toolCallId: call.id,
      toolName: call.name,
      request,
      output: execution.output,
      failed: execution.failed,
    });
    await runPostToolUseSideEffects(
      runtime,
      call,
      toolInputFromArgumentsJson(call.argumentsJson),
      execution.output,
      Date.now() - startedAt,
      execution.failed,
    );
    currentState = runtime.options.appendToolResultMessage(
      currentState,
      call.id,
      execution.output.summaryText,
    );
    if (queueRemainingToolCallsAsync(
      runtime,
      currentState,
      pendingUserInput,
      remaining,
      turn,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      earlyToolExecutions,
    )) {
      return;
    }
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

export interface CommitToolExecutionOutputOptions<ToolRequest> {
  toolCallId: string;
  toolName: string;
  request: ToolRequest;
  output: ToolExecutionOutput;
  failed: boolean;
}

export function buildRuntimeToolExecution<ToolRequest>(
  options: CommitToolExecutionOutputOptions<ToolRequest>,
): RuntimeToolExecution<ToolRequest> {
  const artifacts = toolArtifactsFromOutput(options.output);
  return {
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    request: options.request,
    output: options.output.summaryText,
    failed: options.failed,
    ...(artifacts ? { artifacts } : {}),
    ...(options.output.hostUi ? { hostUi: options.output.hostUi } : {}),
  };
}

export function shouldSkipPersistAssistantToolCalls(
  historyStore: readonly LlmMessage[],
  calls: ToolCallRequest[],
): boolean {
  if (calls.length === 0) {
    return true;
  }

  const pendingIds = new Set(calls.map((call) => call.id));
  for (const message of historyStore) {
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }
    const existingIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
    if ([...pendingIds].every((id) => existingIds.has(id))) {
      return true;
    }
  }

  return false;
}

function persistAssistantToolCalls<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<
    TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    'historyStore' | 'options'
  >,
  state: State,
  calls: ToolCallRequest[],
): void {
  if (calls.length === 0) {
    return;
  }

  const skipped = shouldSkipPersistAssistantToolCalls(runtime.historyStore, calls);
  if (skipped) {
    return;
  }

  const preservedMessage = runtime.options.assistantToolCallMessageFromState?.(state, calls);
  if (preservedMessage) {
    runtime.historyStore.push({
      role: 'assistant',
      content: cloneLlmMessageContent(preservedMessage.content),
      ...(preservedMessage.toolCalls !== undefined
        ? {
            toolCalls: preservedMessage.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            })),
          }
        : {}),
      ...(preservedMessage.providerState !== undefined
        ? { providerState: cloneLlmProviderState(preservedMessage.providerState) }
        : {}),
    });
    return;
  }

  runtime.historyStore.push({
    role: 'assistant',
    content: [],
    toolCalls: calls.map((call) => ({
      id: call.id,
      name: call.name,
      argumentsJson: call.argumentsJson,
    })),
  });
}

function requestStubFromToolCall(call: ToolCallRequest): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.argumentsJson) as Record<string, unknown>;
    return { name: call.name, ...parsed };
  } catch {
    return { name: call.name };
  }
}

export function commitToolCallSchemaError<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<
    TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    'emitEvent' | 'historyStore'
  >,
  turn: RuntimeTurnContext<ToolRequest>,
  call: ToolCallRequest,
  error: unknown,
): RuntimeToolExecution<ToolRequest> {
  const outputText = `[tool schema error] ${renderError(error)}`;
  return commitSyntheticToolExecutionFailure(
    runtime,
    turn,
    requestStubFromToolCall(call) as ToolRequest,
    call.id,
    call.name,
    outputText,
  );
}

export function commitSyntheticToolExecutionFailure<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<
    TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
    'emitEvent' | 'historyStore'
  >,
  turn: RuntimeTurnContext<ToolRequest>,
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  outputText: string,
): RuntimeToolExecution<ToolRequest> {
  const content = createLlmMessageContentFromText(outputText);
  runtime.historyStore.push({
    role: 'tool',
    toolCallId,
    content,
  });

  return commitToolExecutionOutput(runtime, turn, {
    toolCallId,
    toolName,
    request,
    output: {
      content,
      summaryText: outputText,
    },
    failed: true,
  });
}

export function commitToolExecutionOutput<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>, 'emitEvent'>,
  turn: RuntimeTurnContext<ToolRequest>,
  options: CommitToolExecutionOutputOptions<ToolRequest>,
): RuntimeToolExecution<ToolRequest> {
  const finished = buildRuntimeToolExecution(options);
  return commitPreparedToolExecution(runtime, turn, finished, options.output, true);
}

export function commitPreparedToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>, 'emitEvent'>,
  turn: RuntimeTurnContext<ToolRequest>,
  execution: RuntimeToolExecution<ToolRequest>,
  output: ToolExecutionOutput,
  emitFinishedEvent: boolean,
  enqueueDeferredGuidance = true,
): RuntimeToolExecution<ToolRequest> {
  if (!turn.toolExecutions.some((item) => item.toolCallId === execution.toolCallId)) {
    turn.toolExecutions.push(execution);
  }
  if (emitFinishedEvent) {
    runtime.emitEvent({ kind: 'tool-execution-finished', execution });
  }
  if (enqueueDeferredGuidance) {
    enqueueDeferredToolOutputGuidance(turn, execution.toolName, output);
  }
  return execution;
}

export function canonicalizeToolArguments(argumentsJson: string): string | undefined {
  try {
    return JSON.stringify(stableJsonValue(JSON.parse(argumentsJson) as JsonValue));
  } catch {
    return undefined;
  }
}

export function resolveEarlyToolCallArguments(
  name: string,
  argumentsJson: string,
): { argumentsJson: string; canonicalArgumentsJson: string } | undefined {
  const directCanonical = canonicalizeToolArguments(argumentsJson);
  if (directCanonical !== undefined) {
    return { argumentsJson, canonicalArgumentsJson: directCanonical };
  }

  const builtArgumentsJson = buildEarlyExecutableArgumentsJson(name, argumentsJson);
  if (builtArgumentsJson === undefined) {
    return undefined;
  }

  const builtCanonical = canonicalizeToolArguments(builtArgumentsJson);
  if (builtCanonical === undefined) {
    return undefined;
  }

  return { argumentsJson: builtArgumentsJson, canonicalArgumentsJson: builtCanonical };
}

export function startEarlyToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>>,
): PendingEarlyToolExecution<ToolRequest> | undefined {
  const resolved = resolveEarlyToolCallArguments(call.name, call.argumentsJson);
  if (resolved === undefined) {
    return undefined;
  }

  const existing = earlyToolExecutions.get(call.id);
  if (existing) {
    if (existing.canonicalArgumentsJson === resolved.canonicalArgumentsJson) {
      return existing;
    }
    return existing;
  }

  const executionCall: ToolCallRequest = {
    ...call,
    argumentsJson: resolved.argumentsJson,
  };
  const record: PendingEarlyToolExecution<ToolRequest> = {
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: resolved.argumentsJson,
    canonicalArgumentsJson: resolved.canonicalArgumentsJson,
    outcome: runEarlyToolExecution(runtime, executionCall),
  };
  earlyToolExecutions.set(call.id, record);
  return record;
}

async function runEarlyToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  call: ToolCallRequest,
): Promise<PendingEarlyToolExecutionOutcome<ToolRequest>> {
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
  } catch {
    return { kind: 'deferred', reason: 'schema-error' };
  }

  const preGate = await runPreToolUseGate(runtime, call, request);
  if (preGate.kind === 'denied') {
    return { kind: 'deferred', reason: 'authorization-error' };
  }
  request = preGate.request;

  let authorization: AuthorizationDecision<TrustTarget>;
  try {
    authorization = await runtime.options.toolExecutor.authorize(request);
  } catch {
    return { kind: 'deferred', reason: 'authorization-error' };
  }

  if (authorization.kind === 'need-approval') {
    // TODO: preview 已拿到稳定 toolCallId 和参数时，应直接暴露待审批状态，避免正式 tool-calls 阶段前审批表单仍未打开。
    return { kind: 'deferred', reason: 'approval-required' };
  }
  if (authorization.kind === 'need-questions') {
    return { kind: 'deferred', reason: 'questions-required' };
  }

  if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
    return { kind: 'deferred', reason: 'background-required' };
  }

  const internal = await runtime.tryPerformEarlyInternalToolCall?.(
    request,
    call.id,
    call.name,
  );
  if (internal?.kind === 'defer-to-formal') {
    return { kind: 'deferred', reason: 'internal-deferred' };
  }

  runtime.emitEvent({
    kind: 'tool-call-started',
    toolCallId: call.id,
    toolName: call.name,
    request,
  });

  const external = internal === undefined
    ? await performEarlyExternalToolExecution(runtime, request)
    : undefined;
  const output = internal?.kind === 'completed'
    ? internal.output
    : external?.output;
  const failed = internal?.kind === 'completed'
    ? internal.failed
    : external?.failed;
  if (!output || failed === undefined) {
    return { kind: 'deferred', reason: 'internal-deferred' };
  }
  const fatalError = internal?.kind === 'completed' ? internal.fatalError : undefined;
  const enqueueDeferredGuidance = internal?.kind === 'completed'
    ? internal.enqueueDeferredGuidance ?? true
    : true;
  const execution = buildRuntimeToolExecution({
    toolCallId: call.id,
    toolName: call.name,
    request,
    output,
    failed,
  });
  runtime.emitEvent({ kind: 'tool-execution-finished', execution });
  await runPostToolUseSideEffects(
    runtime,
    call,
    toolInputFromArgumentsJson(call.argumentsJson),
    output,
    0,
    failed,
  );
  return {
    kind: 'completed',
    request,
    execution,
    output,
    enqueueDeferredGuidance,
    ...(fatalError !== undefined ? { fatalError } : {}),
  };
}

async function performEarlyExternalToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  request: ToolRequest,
): Promise<ToolExecutionResult> {
  try {
    const output = await runtime.options.toolExecutor.execute(request);
    return {
      output,
      failed: false,
      backgroundExecution: false,
    };
  } catch (error) {
    const summaryText = `[tool error] ${renderError(error)}`;
    return {
      output: {
        content: createLlmMessageContentFromText(summaryText),
        summaryText,
      },
      failed: true,
      backgroundExecution: false,
    };
  }
}

function persistCompletedEarlyToolResult<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: Pick<TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>, 'historyStore'>,
  toolCallId: string,
  output: ToolExecutionOutput,
): void {
  if (output.content.length === 0) {
    return;
  }
  runtime.historyStore.push({
    role: 'tool',
    toolCallId,
    content: cloneLlmMessageContent(output.content),
  });
}

async function matchingEarlyToolExecutionOutcome<ToolRequest>(
  call: ToolCallRequest,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>> | undefined,
): Promise<PendingEarlyToolExecutionOutcome<ToolRequest> | undefined> {
  const early = earlyToolExecutions?.get(call.id);
  if (!early || early.toolName !== call.name) {
    return undefined;
  }

  const canonicalArgumentsJson = canonicalizeToolArguments(call.argumentsJson);
  if (canonicalArgumentsJson === undefined) {
    return undefined;
  }
  if (
    canonicalArgumentsJson !== early.canonicalArgumentsJson &&
    !earlyToolArgumentsMatchFormal(call.name, early.canonicalArgumentsJson, call.argumentsJson)
  ) {
    return undefined;
  }

  const outcome = await early.outcome;
  return outcome.kind === 'completed' ? outcome : undefined;
}

function earlyToolArgumentsMatchFormal(
  toolName: string,
  earlyCanonicalJson: string,
  formalArgumentsJson: string,
): boolean {
  const formalCanonical = canonicalizeToolArguments(formalArgumentsJson);
  if (formalCanonical === undefined || formalCanonical === earlyCanonicalJson) {
    return formalCanonical === earlyCanonicalJson;
  }

  if (
    toolName !== 'read_file' &&
    toolName !== 'list_directory_files' &&
    toolName !== 'delete_file'
  ) {
    return false;
  }

  let early: Record<string, unknown>;
  let formal: Record<string, unknown>;
  try {
    early = JSON.parse(earlyCanonicalJson) as Record<string, unknown>;
    formal = JSON.parse(formalCanonical) as Record<string, unknown>;
  } catch {
    return false;
  }

  if (typeof early.path !== 'string' || early.path !== formal.path) {
    return false;
  }

  const earlyKeys = Object.keys(early).sort();
  if (earlyKeys.length !== 1 || earlyKeys[0] !== 'path') {
    return false;
  }

  if (toolName === 'read_file') {
    if (early.start_line === formal.start_line && early.end_line === formal.end_line) {
      return true;
    }
    return formal.start_line === undefined && formal.end_line === undefined;
  }

  return true;
}

function stableJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJsonValue(item)]),
    );
  }
  return value;
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

function createQuestions<ToolRequest>(
  request: ToolRequest,
  toolCallId: string,
  toolName: string,
  questions: RuntimePendingQuestions<ToolRequest>['questions'],
): RuntimePendingQuestions<ToolRequest> {
  return {
    request,
    toolCallId,
    toolName,
    questions,
  };
}

function queueRemainingToolCallsAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  pendingUserInput: string,
  remaining: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming: boolean,
  streamingEmitBeginResponse: boolean,
  earlyToolExecutions: Map<string, PendingEarlyToolExecution<ToolRequest>> | undefined,
): boolean {
  if (remaining.length === 0) {
    return false;
  }

  runtime.queuePendingToolCallContinuation(
    state,
    pendingUserInput,
    remaining,
    turn,
    resumeAsStreaming,
    streamingEmitBeginResponse,
    earlyToolExecutions,
  );
  return true;
}
