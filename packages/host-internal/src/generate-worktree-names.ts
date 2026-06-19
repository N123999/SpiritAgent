import {
  appendLlmToolResultMessages,
  createLlmTransport,
  extractLastLlmAssistantText,
  startLlmToolAgentState,
  type JsonValue,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type LlmToolAgentBasicInfo,
  type LlmTransportConfig,
  type ToolExecutor,
} from '@spirit-agent/core';

import {
  buildWorktreeNamingPrompt,
  parseGeneratedWorktreeNamingResponse,
  type GeneratedWorktreeNames,
} from './worktree-naming.js';

export interface WorktreeNamingErrorMessages {
  failurePrefix: (error: string) => string;
  noBody: string;
  interactiveTool: (toolName: string) => string;
  incomplete: string;
}

export interface GenerateWorktreeNamesFromTaskInput {
  transport: LlmTransportConfig;
  task: string;
  baseBranch: string;
  repoRoot: string;
  workspaceRoot: string;
  toolExecutor: ToolExecutor;
  enabledRules?: readonly LlmEnabledRule[];
  enabledSkillCatalog?: readonly LlmEnabledSkillCatalogEntry[];
  extensionSystemPrompts?: readonly LlmExtensionSystemPrompt[];
  planMetadata?: LlmPlanMetadata;
  runtimeBasicInfo?: LlmToolAgentBasicInfo;
  dreamContextText?: string;
  extraToolDefinitions?: JsonValue;
  errorMessages?: WorktreeNamingErrorMessages;
}

const defaultErrorMessages: WorktreeNamingErrorMessages = {
  failurePrefix: (error) => `Worktree naming failed: ${error}`,
  noBody: 'Worktree naming returned no assistant text.',
  interactiveTool: (toolName) => `Worktree naming cannot run interactive tool: ${toolName}`,
  incomplete: 'Worktree naming did not finish within the allowed rounds.',
};

export async function generateWorktreeNamesFromTask(
  input: GenerateWorktreeNamesFromTaskInput,
): Promise<GeneratedWorktreeNames> {
  const prompt = buildWorktreeNamingPrompt({
    userPrompt: input.task,
    baseBranch: input.baseBranch,
    repoRoot: input.repoRoot,
  });
  const assistantText = await runWorktreeNamingToolAgentRounds({
    transport: input.transport,
    prompt,
    workspaceRoot: input.workspaceRoot,
    toolExecutor: input.toolExecutor,
    enabledRules: input.enabledRules ?? [],
    enabledSkillCatalog: input.enabledSkillCatalog ?? [],
    extensionSystemPrompts: input.extensionSystemPrompts ?? [],
    ...(input.planMetadata !== undefined ? { planMetadata: input.planMetadata } : {}),
    ...(input.runtimeBasicInfo !== undefined ? { runtimeBasicInfo: input.runtimeBasicInfo } : {}),
    ...(input.dreamContextText !== undefined ? { dreamContextText: input.dreamContextText } : {}),
    extraToolDefinitions: input.extraToolDefinitions ?? [],
    errorMessages: input.errorMessages ?? defaultErrorMessages,
  });
  return parseGeneratedWorktreeNamingResponse(assistantText);
}

async function runWorktreeNamingToolAgentRounds(input: {
  transport: LlmTransportConfig;
  prompt: string;
  workspaceRoot: string;
  toolExecutor: ToolExecutor;
  enabledRules: readonly LlmEnabledRule[];
  enabledSkillCatalog: readonly LlmEnabledSkillCatalogEntry[];
  extensionSystemPrompts: readonly LlmExtensionSystemPrompt[];
  planMetadata?: LlmPlanMetadata;
  runtimeBasicInfo?: LlmToolAgentBasicInfo;
  dreamContextText?: string;
  extraToolDefinitions: JsonValue;
  errorMessages: WorktreeNamingErrorMessages;
}): Promise<string> {
  const llmTransport = createLlmTransport(input.transport);
  const toolExecutor = input.toolExecutor as ToolExecutor & {
    setActiveTransportConfig?: (config: LlmTransportConfig) => void;
  };
  toolExecutor.setActiveTransportConfig?.(input.transport);

  let toolState = startLlmToolAgentState(
    [],
    input.prompt,
    input.workspaceRoot,
    [...input.enabledRules],
    [...input.enabledSkillCatalog],
    [],
    input.transport.model,
    input.planMetadata,
    [...input.extensionSystemPrompts],
    input.dreamContextText || undefined,
    input.runtimeBasicInfo,
  );

  for (let round = 0; round < 6; round += 1) {
    const completion = await llmTransport.startToolAgentRound(
      input.transport,
      toolState,
      input.extraToolDefinitions,
    );

    if (completion.kind !== 'success') {
      throw new Error(input.errorMessages.failurePrefix(completion.error));
    }

    toolState = completion.result.state;

    if (completion.result.step.kind === 'final-response-ready') {
      const assistantText = extractLastLlmAssistantText(toolState)?.trim();
      if (!assistantText) {
        throw new Error(input.errorMessages.noBody);
      }
      return assistantText;
    }

    const toolResults = [];
    for (const call of completion.result.step.calls) {
      const request = await input.toolExecutor.requestFromFunctionCall(call.name, call.argumentsJson);
      const requestWithMetadata = input.toolExecutor.attachRequestMetadata
        ? input.toolExecutor.attachRequestMetadata(request, {
            toolCallId: call.id,
            toolName: call.name,
          })
        : request;
      const authorization = await input.toolExecutor.authorize(requestWithMetadata);
      if (authorization.kind !== 'allowed') {
        throw new Error(input.errorMessages.interactiveTool(call.name));
      }
      const output = await input.toolExecutor.execute(requestWithMetadata);
      toolResults.push({
        toolCallId: call.id,
        content: output.summaryText,
      });
    }

    toolState = appendLlmToolResultMessages(toolState, toolResults);
  }

  throw new Error(input.errorMessages.incomplete);
}
