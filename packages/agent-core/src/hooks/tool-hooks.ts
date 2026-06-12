import type { JsonObject, ToolCallRequest, ToolExecutionOutput } from '../ports.js';
import type { TurnMachineRuntime } from '../runtime/turn-machine.js';

import { HookDeniedError } from './errors.js';
import {
  appendHookAdditionalContexts,
  applyUpdatedToolRequest,
  runPostToolUseHook,
  runPreToolUseHook,
  toolInputFromArgumentsJson,
} from './integration.js';

export type PreToolUseGateResult<ToolRequest> =
  | { kind: 'ready'; request: ToolRequest }
  | { kind: 'denied'; error: HookDeniedError };

export async function runPreToolUseGate<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  call: ToolCallRequest,
  request: ToolRequest,
): Promise<PreToolUseGateResult<ToolRequest>> {
  try {
    const toolInput = toolInputFromArgumentsJson(call.argumentsJson);
    const preHook = await runPreToolUseHook(runtime.options, call, toolInput);
    if (preHook.updatedInput) {
      const updated = await applyUpdatedToolRequest(
        runtime.options.toolExecutor,
        call,
        preHook.updatedInput,
        request,
      );
      return { kind: 'ready', request: updated };
    }
    return { kind: 'ready', request };
  } catch (error) {
    if (error instanceof HookDeniedError) {
      return { kind: 'denied', error };
    }
    throw error;
  }
}

export async function runPostToolUseSideEffects<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: TurnMachineRuntime<Config, State, ToolRequest, TrustTarget>,
  call: Pick<ToolCallRequest, 'id' | 'name' | 'argumentsJson'>,
  toolInput: JsonObject,
  output: ToolExecutionOutput,
  durationMs: number,
  failed: boolean,
): Promise<void> {
  const postHook = await runPostToolUseHook(runtime.options, {
    toolName: call.name,
    toolCallId: call.id,
    toolInput,
    toolOutput: output.summaryText,
    durationMs,
    failed,
  });
  appendHookAdditionalContexts(
    runtime.recordContextMessage
      ? (role, content) => runtime.recordContextMessage!(role, content)
      : undefined,
    postHook.additionalContexts,
  );
}

export function hookDeniedToolOutput(error: HookDeniedError): string {
  return error.agentMessage ?? error.userMessage ?? error.message;
}
