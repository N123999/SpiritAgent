import {
  AgentRuntime,
  assistantToolCallMessageFromLlmState,
  appendLlmUserLlmMessage,
  normalizeStoredLlmMessage,
  type SpiritLlmTransport,
  appendLlmToolResultMessage,
  appendLlmUserMessage,
  buildApplyPatchFileToolsPromptSection,
  buildProviderWebSearchPromptSection,
  continueLlmToolAgentState,
  extractLastLlmAssistantText,
  rebuildLlmToolAgentStateAfterCompaction,
  shouldUseApplyPatchFileTools,
  startLlmToolAgentState,
  truncateLlmHistoryForCompaction,
  truncateLlmToolAgentStateForContextRetry,
  type ChatArchive,
  type LlmActiveSkill,
  type LlmEnabledRule,
  type LlmEnabledSkillCatalogEntry,
  type LlmExtensionSystemPrompt,
  type LlmPlanMetadata,
  type LlmToolAgentBasicInfo,
  type LlmToolAgentState,
  type LlmTransportConfig,
} from '@spirit-agent/agent-core';
import { resolveWorkspaceFileReferenceAttachmentsFromInput } from '@spirit-agent/host-internal';

import type { DesktopToolRequest } from './contracts.js';
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
  planMetadata: LlmPlanMetadata;
  extensionSystemPrompts: LlmExtensionSystemPrompt[];
  dreamsContextText?: string;
  todosContextText?: string;
  toolExecutor: DesktopToolExecutor;
  llmTransport: SpiritLlmTransport;
  activeSkills: LlmActiveSkill[];
  workspaceRoot: string;
  basicInfo: LlmToolAgentBasicInfo;
}): DesktopRuntime {
  const applyPatchFileToolsPromptSection = resolveApplyPatchFileToolsPromptSection(
    input.transportConfig,
  );
  const providerWebSearchPromptSection = resolveProviderWebSearchPromptSection(
    input.transportConfig,
  );

  return new AgentRuntime({
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
        cloneActiveSkills(input.activeSkills),
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.todosContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
      ),
    createContinuationState: (messages) =>
      continueLlmToolAgentState(
        messages,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        cloneActiveSkills(input.activeSkills),
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.todosContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
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
        cloneActiveSkills(input.activeSkills),
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
        input.dreamsContextText,
        input.todosContextText,
        input.basicInfo,
        applyPatchFileToolsPromptSection,
        providerWebSearchPromptSection,
      ),
    resolveWorkspaceFilesFromInput: (userInput) =>
      resolveWorkspaceFileReferenceAttachmentsFromInput(input.workspaceRoot, userInput),
    generateImage: (request) =>
      input.llmTransport.generateImage(
        input.transportConfig,
        request,
        (saveRequest) => input.toolExecutor.saveGeneratedImage(saveRequest),
      ),
  }, input.history.map((message) => normalizeStoredLlmMessage(message)));
}

export function cloneActiveSkills(skills: LlmActiveSkill[]): LlmActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}

function resolveApplyPatchFileToolsPromptSection(
  config: LlmTransportConfig,
): string | undefined {
  return config.transportKind === 'open-responses' && shouldUseApplyPatchFileTools(config)
    ? buildApplyPatchFileToolsPromptSection()
    : undefined;
}

function resolveProviderWebSearchPromptSection(
  config: LlmTransportConfig,
): string | undefined {
  return buildProviderWebSearchPromptSection(config);
}