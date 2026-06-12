import type { JsonObject, ToolCallRequest } from '../ports.js';
import type { AgentRuntimeOptions } from '../runtime/types.js';

import { HookDeniedError } from './errors.js';
import type {
  HookRunResult,
  HookRunner,
  HookSessionContext,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from './types.js';

export const DEFAULT_HOOK_SESSION_CONTEXT: HookSessionContext = {
  sessionId: undefined,
  conversationPath: undefined,
  workspaceRoot: undefined,
  model: undefined,
};

export function resolveHookSessionContext<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
): HookSessionContext {
  return options.hookSessionContext ?? DEFAULT_HOOK_SESSION_CONTEXT;
}

export function resolveHookRunner<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
): HookRunner | undefined {
  return options.hookRunner;
}

export function toolInputFromArgumentsJson(argumentsJson: string): JsonObject {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // fall through
  }
  return { rawArgumentsJson: argumentsJson };
}

export function throwIfHookDenied(event: string, result: HookRunResult): void {
  if (!result.denied) {
    return;
  }
  throw new HookDeniedError({
    hookEventName: event,
    userMessage: result.userMessage,
    agentMessage: result.agentMessage,
  });
}

export function appendHookAdditionalContexts(
  recordContextMessage: ((role: 'system', content: string) => void) | undefined,
  contexts: readonly string[],
): void {
  if (!recordContextMessage || contexts.length === 0) {
    return;
  }
  for (const context of contexts) {
    const trimmed = context.trim();
    if (trimmed) {
      recordContextMessage('system', trimmed);
    }
  }
}

function baseHookFields(context: HookSessionContext) {
  return {
    sessionId: context.sessionId,
    conversationPath: context.conversationPath,
    workspaceRoot: context.workspaceRoot,
    model: context.model,
  };
}

export async function runPreToolUseHook<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  call: ToolCallRequest,
  toolInput: JsonObject,
): Promise<HookRunResult> {
  const hookRunner = resolveHookRunner(options);
  if (!hookRunner) {
    return {
      records: [],
      denied: false,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  }

  const input: Omit<PreToolUseHookInput, 'hookEventName' | 'timestamp'> = {
    ...baseHookFields(resolveHookSessionContext(options)),
    toolName: call.name,
    toolCallId: call.id,
    toolInput,
  };

  const result = await hookRunner.runPreToolUse(input);
  throwIfHookDenied('preToolUse', result);
  return result;
}

export async function runPostToolUseHook<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  input: Omit<PostToolUseHookInput, 'hookEventName' | 'timestamp' | keyof HookSessionContext>,
): Promise<HookRunResult> {
  const hookRunner = resolveHookRunner(options);
  if (!hookRunner) {
    return {
      records: [],
      denied: false,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  }

  return hookRunner.runPostToolUse({
    ...baseHookFields(resolveHookSessionContext(options)),
    ...input,
  });
}

export async function runSubmitPromptHook<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  prompt: string,
  messageId: string | undefined = undefined,
): Promise<HookRunResult> {
  const hookRunner = resolveHookRunner(options);
  if (!hookRunner) {
    return {
      records: [],
      denied: false,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    };
  }

  const result = await hookRunner.runSubmitPrompt({
    ...baseHookFields(resolveHookSessionContext(options)),
    prompt,
    messageId,
  });
  throwIfHookDenied('submitPrompt', result);
  return result;
}

export async function applyUpdatedToolRequest<
  ToolRequest,
  TrustTarget = string,
>(
  toolExecutor: AgentRuntimeOptions<unknown, unknown, ToolRequest, TrustTarget>['toolExecutor'],
  call: ToolCallRequest,
  updatedInput: JsonObject,
  existingRequest: ToolRequest,
): Promise<ToolRequest> {
  try {
    const next = await toolExecutor.requestFromFunctionCall(
      call.name,
      JSON.stringify(updatedInput),
    );
    return toolExecutor.attachRequestMetadata?.(next, {
      toolCallId: call.id,
      toolName: call.name,
    }) ?? next;
  } catch {
    return existingRequest;
  }
}
