import {
  AgentRuntime,
  assistantToolCallMessageFromLlmState,
  appendLlmToolResultMessage,
  appendLlmUserLlmMessage,
  appendLlmUserMessage,
  buildApplyPatchFileToolsPromptSection,
  buildProviderWebSearchPromptSection,
  continueLlmToolAgentState,
  extractLastLlmAssistantText,
  normalizeStoredLlmMessage,
  rebuildLlmToolAgentStateAfterCompaction,
  shouldUseApplyPatchFileTools,
  startLlmToolAgentState,
  truncateLlmHistoryForCompaction,
  truncateLlmToolAgentStateForContextRetry,
  type ChatArchive,
  type HookRunner,
  type HookSessionContext,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type ToolAgentMcpToolCatalogSnapshot,
  type LlmToolAgentBasicInfo,
  type LlmToolAgentState,
  type LlmTransportConfig,
  type SpiritLlmTransport,
  type SubagentWorkspaceBootstrap,
} from '@spirit-agent/core';
import {
  persistPreCompactionHistoryArchive,
  persistToolOutputArchive,
  removePreCompactionHistoryArchive,
} from '@spirit-agent/host-internal';

import type { DesktopToolRequest } from './contracts.js';
import { spiritAgentDataDir } from './storage.js';
import type { DesktopToolExecutor } from './tool-executor.js';

export type DesktopRuntime = AgentRuntime<
  LlmTransportConfig,
  LlmToolAgentState,
  DesktopToolRequest,
  string
>;

export function createDesktopRuntime(input: {
  transportConfig: LlmTransportConfig;
  history: ChatArchive['llmHistory'];
  enabledRules: LlmEnabledRule[];
  enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  mcpToolCatalog?: ToolAgentMcpToolCatalogSnapshot;
  planMetadata: LlmPlanMetadata;
  extensionSystemPrompts: LlmExtensionSystemPrompt[];
  dreamsContextText?: string;
  toolExecutor: DesktopToolExecutor;
  llmTransport: SpiritLlmTransport;
  workspaceRoot: string;
  basicInfo: LlmToolAgentBasicInfo;
  getLoopEnabled?: () => boolean;
  hookRunner?: HookRunner;
  hookSessionContext?: HookSessionContext;
  bootstrapSubagentWorkspace?: SubagentWorkspaceBootstrap<DesktopToolRequest, string>;
}): DesktopRuntime {
  const resolveLoopEnabled = () => input.getLoopEnabled?.() === true;
  const applyPatchFileToolsPromptSection = resolveApplyPatchFileToolsPromptSection(
    input.transportConfig,
    input.planMetadata,
  );
  const providerWebSearchPromptSection = resolveProviderWebSearchPromptSection(
    input.transportConfig,
  );

  return new AgentRuntime<
    LlmTransportConfig,
    LlmToolAgentState,
    DesktopToolRequest,
    string
  >({
    config: input.transportConfig,
    llmTransport: input.llmTransport,
    toolExecutor: input.toolExecutor,
    createToolAgentState: (messages, userInput) =>
      startLlmToolAgentState(
        messages,
        userInput,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
        resolveLoopEnabled(),
        input.mcpToolCatalog,
      ),
    createContinuationState: (messages) =>
      continueLlmToolAgentState(
        messages,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
        resolveLoopEnabled(),
        input.mcpToolCatalog,
      ),
    appendToolResultMessage: appendLlmToolResultMessage,
    assistantToolCallMessageFromState: assistantToolCallMessageFromLlmState,
    appendUserMessage: appendLlmUserMessage,
    appendUserLlmMessage: (state, message) => appendLlmUserLlmMessage(state, message, input.workspaceRoot),
    extractAssistantText: extractLastLlmAssistantText,
    truncateStateForContextRetry: truncateLlmToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (messages, userInput, retryState) =>
      rebuildLlmToolAgentStateAfterCompaction(
        messages,
        userInput,
        retryState,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
        resolveLoopEnabled(),
        input.mcpToolCatalog,
      ),
    resolveWorkspaceFilesFromInput: async () => [],
    generateImage: (request) =>
      input.llmTransport.generateImage(
        input.transportConfig,
        request,
        (saveRequest) => input.toolExecutor.saveGeneratedImage(saveRequest),
      ),
    generateVideo: (request) =>
      input.llmTransport.generateVideo(
        input.transportConfig,
        request,
        (saveRequest) => input.toolExecutor.saveGeneratedVideo(saveRequest),
      ),
    ...(input.hookRunner ? { hookRunner: input.hookRunner } : {}),
    ...(input.hookSessionContext ? { hookSessionContext: input.hookSessionContext } : {}),
    ...(input.bootstrapSubagentWorkspace
      ? { bootstrapSubagentWorkspace: input.bootstrapSubagentWorkspace }
      : {}),
    persistPreCompactionHistory: async ({ archive, sessionId }) =>
      persistPreCompactionHistoryArchive(spiritAgentDataDir(), archive, {
        ...(sessionId !== undefined ? { sessionId } : {}),
      }),
    removePreCompactionHistoryArchive: async (archivePath) =>
      removePreCompactionHistoryArchive(archivePath),
    persistToolOutputArchive: async (input) =>
      persistToolOutputArchive(spiritAgentDataDir(), input),
  }, input.history.map((message) => normalizeStoredLlmMessage(message)));
}

export function buildDesktopRuntimeBasicInfo(
  workspaceRoot: string,
  toolExecutor: DesktopToolExecutor,
  gitBranch?: string,
): LlmToolAgentBasicInfo {
  const shell = toolExecutor.toolDefinitionEnvironment();
  const normalizedGitBranch = gitBranch?.trim();
  return {
    workspaceRoot,
    ...(normalizedGitBranch ? { gitBranch: normalizedGitBranch } : {}),
    terminal: shell.shellDisplayName,
    system: toolExecutor.operatingSystemInfo(),
  };
}

export function cloneActiveSkills(skills: LlmActiveSkill[]): LlmActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}

function resolveApplyPatchFileToolsPromptSection(
  config: LlmTransportConfig,
  planMetadata: LlmPlanMetadata,
): string | undefined {
  const agentMode = planMetadata.agentMode ?? 'agent';
  return config.transportKind === 'open-responses' && shouldUseApplyPatchFileTools(config, { agentMode })
    ? buildApplyPatchFileToolsPromptSection()
    : undefined;
}

function resolveProviderWebSearchPromptSection(
  config: LlmTransportConfig,
): string | undefined {
  return buildProviderWebSearchPromptSection(config);
}