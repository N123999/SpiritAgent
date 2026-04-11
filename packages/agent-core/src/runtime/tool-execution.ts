import type { LlmMessage } from '../ports.js';

import { TOOL_MEMORY_MAX_ENTRIES } from './constants.js';
import { defaultToolMemoryFormatter, pruneToolMemories, renderError } from './helpers.js';
import type { AgentRuntimeOptions, RuntimeEvent } from './types.js';

export interface ToolExecutionResult {
  output: string;
  failed: boolean;
  backgroundExecution: boolean;
}

export interface ToolExecutionRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  pendingBackgroundToolStatusStore: string | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
}

export async function performToolExecution<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
  request: ToolRequest,
  toolName: string,
): Promise<ToolExecutionResult> {
  let output: string;
  let failed = false;
  const backgroundExecution = runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false;
  const backgroundStatusText = backgroundExecution
    ? runtime.options.toolExecutor.backgroundStatusText?.(request)
    : undefined;

  if (backgroundExecution) {
    runtime.pendingBackgroundToolStatusStore = backgroundStatusText;
    runtime.emitEvent({
      kind: 'background-tool-status',
      phase: 'started',
      toolName,
      request,
      ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
    });
  }

  try {
    output = await runtime.options.toolExecutor.execute(request);
  } catch (error) {
    failed = true;
    output = `[tool error] ${renderError(error)}`;
  } finally {
    if (backgroundExecution) {
      runtime.pendingBackgroundToolStatusStore = undefined;
      runtime.emitEvent({
        kind: 'background-tool-status',
        phase: 'finished',
        toolName,
        request,
        ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
        failed,
      });
    }
  }

  persistToolExecutionMemory(runtime, request, output);
  return {
    output,
    failed,
    backgroundExecution,
  };
}

export function persistToolExecutionMemory<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ToolExecutionRuntime<Config, State, ToolRequest, TrustTarget>,
  request: ToolRequest,
  output: string,
): void {
  const toolMemory = (runtime.options.formatToolMemory ?? defaultToolMemoryFormatter)(
    request,
    output,
  );
  if (toolMemory?.trim()) {
    runtime.historyStore.push({
      role: 'system',
      content: toolMemory,
      imagePaths: [],
    });
    pruneToolMemories(
      runtime.historyStore,
      runtime.options.maxToolMemoryEntries ?? TOOL_MEMORY_MAX_ENTRIES,
    );
  }
}