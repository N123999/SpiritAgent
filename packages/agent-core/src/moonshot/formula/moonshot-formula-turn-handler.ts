import type { OpenAiTransportConfig } from '../../openai/openai-compat.js';
import type { ToolCallRequest } from '../../ports.js';
import { createLlmMessageContentFromText } from '../../ports.js';
import {
  commitSyntheticToolExecutionFailure,
  commitToolExecutionOutput,
  processToolCalls,
  processToolCallsAsync,
  runTurnLoop,
  startToolAgentRoundAsync,
  type TurnMachineRuntime,
} from '../../runtime/turn-machine.js';
import { prepareAndSyncRuntimeToolResultToHistory } from '../../runtime/tool-output-append.js';
import type {
  RuntimeTurnContext,
  RuntimeTurnResult,
} from '../../runtime/types.js';
import { executeMoonshotFormulaToolCall, isMoonshotFormulaManagedToolCall } from './moonshot-formula-tool-loop.js';
import { buildMoonshotFormulaToolPreviewArgumentsJson } from './formula-spirit-ui.js';
import { readMoonshotFormulaWebSearchQuery } from './moonshot-formula-tool-loop.js';

function readPreviewQuery(argumentsJson: string): string {
  return readMoonshotFormulaWebSearchQuery(argumentsJson);
}

export type ManagedProviderToolCallOutcome<
  State,
  ToolRequest,
  TrustTarget,
> =
  | { kind: 'not-handled' }
  | { kind: 'advance'; state: State }
  | { kind: 'turn-result'; result: RuntimeTurnResult<State, ToolRequest, TrustTarget> };

function providerFormulaToolRequestStub<ToolRequest>(
  call: ToolCallRequest,
): ToolRequest {
  return {
    name: call.name,
    argumentsJson: call.argumentsJson,
  } as ToolRequest;
}

function moonshotFormulaToolSummaryText(toolName: string, failed: boolean): string {
  if (failed) {
    return `[moonshot formula ${toolName}] failed`;
  }
  return `[moonshot formula ${toolName}] completed`;
}

async function executeAndCommitMoonshotFormulaToolCall<
  Config,
  State,
  ToolRequest,
  TrustTarget,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  state: State,
  call: ToolCallRequest,
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<{ state: State; failed: boolean; modelContent: string }> {
  const config = runtime.options.config as OpenAiTransportConfig;
  const request = providerFormulaToolRequestStub<ToolRequest>(call);

  runtime.emitEvent({
    kind: 'streaming-tool-preview',
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: buildMoonshotFormulaToolPreviewArgumentsJson({
      query: readPreviewQuery(call.argumentsJson),
      status: 'in_progress',
    }),
  });

  const execution = await executeMoonshotFormulaToolCall(config, call);
  runtime.emitEvent({
    kind: 'streaming-tool-preview',
    toolCallId: call.id,
    toolName: call.name,
    argumentsJson: execution.previewArgumentsJson,
  });

  if (execution.kind === 'failed') {
    commitSyntheticToolExecutionFailure(
      runtime,
      turn,
      request,
      call.id,
      call.name,
      execution.error,
    );
    const resumedState = runtime.options.appendToolResultMessage(
      state,
      call.id,
      execution.error,
    );
    return { state: resumedState, failed: true, modelContent: execution.error };
  }

  const summaryText = moonshotFormulaToolSummaryText(call.name, false);
  const content = createLlmMessageContentFromText(summaryText);
  commitToolExecutionOutput(runtime, turn, {
    toolCallId: call.id,
    toolName: call.name,
    request,
    output: {
      content,
      summaryText,
    },
    failed: false,
  });

  await prepareAndSyncRuntimeToolResultToHistory(runtime, call.id, execution.content);

  const resumedState = runtime.options.appendToolResultMessage(
    state,
    call.id,
    execution.content,
  );
  return { state: resumedState, failed: false, modelContent: execution.content };
}

export async function handleManagedProviderToolCallInTurn<
  Config,
  State,
  ToolRequest,
  TrustTarget,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
  state: State,
  call: ToolCallRequest,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
): Promise<ManagedProviderToolCallOutcome<State, ToolRequest, TrustTarget>> {
  if (!isMoonshotFormulaManagedToolCall(call.name, runtime.options.config)) {
    return { kind: 'not-handled' };
  }

  const { state: resumedState } = await executeAndCommitMoonshotFormulaToolCall(
    runtime,
    state,
    call,
    turn,
  );

  if (remainingCalls.length > 0) {
    return {
      kind: 'turn-result',
      result: await processToolCalls(
        runtime,
        resumedState,
        pendingUserInput,
        remainingCalls,
        turn,
      ),
    };
  }

  return {
    kind: 'turn-result',
    result: await runTurnLoop(runtime, resumedState, pendingUserInput, turn),
  };
}

export async function handleManagedProviderToolCallInTurnAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  pendingUserInput: string,
  state: State,
  call: ToolCallRequest,
  remainingCalls: ToolCallRequest[],
  turn: RuntimeTurnContext<ToolRequest>,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
): Promise<boolean> {
  if (!isMoonshotFormulaManagedToolCall(call.name, runtime.options.config)) {
    return false;
  }

  const { state: resumedState } = await executeAndCommitMoonshotFormulaToolCall(
    runtime,
    state,
    call,
    turn,
  );

  if (remainingCalls.length > 0) {
    await processToolCallsAsync(
      runtime,
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
    await runtime.startStreamingRound(
      resumedState,
      pendingUserInput,
      turn,
      streamingEmitBeginResponse,
    );
    return true;
  }

  startToolAgentRoundAsync(runtime, resumedState, pendingUserInput, turn);
  return true;
}

export function shouldSkipEarlyExecutionForManagedProviderTool(
  toolName: string,
  config: unknown,
): boolean {
  return isMoonshotFormulaManagedToolCall(toolName, config);
}