import { appendLlmUserLlmMessage } from '../llm-tool-agent.js';
import {
  patchBasicInfoWorkspaceRootInToolAgentState,
  type ToolAgentState,
} from '../tool-agent.js';
import type { AgentRuntimeOptions } from './types.js';
import { pendingWorkspaceFilesFromInput } from './helpers.js';

function isToolAgentLikeState(state: unknown): state is ToolAgentState {
  return (
    typeof state === 'object'
    && state !== null
    && 'messages' in state
    && Array.isArray((state as ToolAgentState).messages)
    && typeof (state as ToolAgentState).steps === 'number'
  );
}

function patchConfigWorkspaceRoot<Config>(config: Config, scopedRoot: string): Config {
  if (typeof config !== 'object' || config === null || !('workspaceRoot' in config)) {
    return config;
  }
  return { ...(config as Record<string, unknown>), workspaceRoot: scopedRoot } as Config;
}

function patchStateWorkspaceRoot<State>(state: State, scopedRoot: string): State {
  if (!isToolAgentLikeState(state)) {
    return state;
  }
  return patchBasicInfoWorkspaceRootInToolAgentState(state, scopedRoot) as State;
}

/** Child subagent runtimes must not inherit the parent workspace in system basic info or transport config. */
export function scopeAgentRuntimeOptionsForSubagentWorkspace<
  Config,
  State,
  ToolRequest,
  TrustTarget,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  scopedWorkspaceRoot: string,
): AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget> {
  const scopedRoot = scopedWorkspaceRoot.trim();
  if (!scopedRoot) {
    return options;
  }

  const scopeState = (state: State): State => patchStateWorkspaceRoot(state, scopedRoot);

  return {
    ...options,
    config: patchConfigWorkspaceRoot(options.config, scopedRoot),
    ...(options.hookSessionContext
      ? { hookSessionContext: { ...options.hookSessionContext, workspaceRoot: scopedRoot } }
      : {}),
    createToolAgentState: (history, userInput) =>
      scopeState(options.createToolAgentState(history, userInput)),
    ...(options.createContinuationState
      ? { createContinuationState: (history) => scopeState(options.createContinuationState!(history)) }
      : {}),
    ...(options.rebuildRetryStateAfterCompaction
      ? {
          rebuildRetryStateAfterCompaction: (history, userInput, retryState) =>
            scopeState(options.rebuildRetryStateAfterCompaction!(history, userInput, retryState)),
        }
      : {}),
    ...(options.appendUserLlmMessage
      ? {
          appendUserLlmMessage: (state, message) =>
            appendLlmUserLlmMessage(state as ToolAgentState, message, scopedRoot) as State,
        }
      : {}),
    ...(options.resolveWorkspaceFilesForRoot
      ? {
          resolveWorkspaceFilesFromInput: (userInput) =>
            options.resolveWorkspaceFilesForRoot!(scopedRoot, userInput),
        }
      : options.resolveWorkspaceFilesFromInput
        ? {
            resolveWorkspaceFilesFromInput: (userInput) =>
              pendingWorkspaceFilesFromInput(scopedRoot, userInput),
          }
        : {}),
  };
}
