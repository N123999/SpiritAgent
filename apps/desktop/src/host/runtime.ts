import {
  AgentRuntime,
  appendOpenAiToolResultMessage,
  appendOpenAiUserMessage,
  continueOpenAiToolAgentState,
  extractLastOpenAiAssistantText,
  pendingWorkspaceFilesFromInput,
  rebuildOpenAiToolAgentStateAfterCompaction,
  startOpenAiToolAgentState,
  truncateOpenAiHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry,
  type ChatArchive,
  type OpenAiActiveSkill,
  type OpenAiEnabledRule,
  type OpenAiEnabledSkillCatalogEntry,
  type OpenAiExtensionSystemPrompt,
  type OpenAiPlanMetadata,
  type OpenAiToolAgentState,
  type OpenAiTransport,
  type OpenAiTransportConfig,
} from '@spirit-agent/agent-core';

import type { DesktopToolRequest } from './contracts.js';
import type { DesktopToolExecutor } from './tool-executor.js';

export type DesktopRuntime = AgentRuntime<
  OpenAiTransportConfig,
  OpenAiToolAgentState,
  DesktopToolRequest,
  string
>;

export function createDesktopRuntime(input: {
  transportConfig: OpenAiTransportConfig;
  history: ChatArchive['llmHistory'];
  enabledRules: OpenAiEnabledRule[];
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[];
  planMetadata: OpenAiPlanMetadata;
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[];
  toolExecutor: DesktopToolExecutor;
  llmTransport: OpenAiTransport;
  activeSkills: OpenAiActiveSkill[];
  workspaceRoot: string;
}): DesktopRuntime {
  return new AgentRuntime({
    config: input.transportConfig,
    llmTransport: input.llmTransport,
    toolExecutor: input.toolExecutor,
    createToolAgentState: (messages, userInput) =>
      startOpenAiToolAgentState(
        messages,
        userInput,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        cloneActiveSkills(input.activeSkills),
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
      ),
    createContinuationState: (messages) =>
      continueOpenAiToolAgentState(
        messages,
        input.workspaceRoot,
        input.enabledRules,
        input.enabledSkillCatalog,
        cloneActiveSkills(input.activeSkills),
        input.transportConfig.model,
        input.planMetadata,
        input.extensionSystemPrompts,
      ),
    appendToolResultMessage: appendOpenAiToolResultMessage,
    appendUserMessage: appendOpenAiUserMessage,
    extractAssistantText: extractLastOpenAiAssistantText,
    truncateStateForContextRetry: truncateOpenAiToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateOpenAiHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (messages, userInput, retryState) =>
      rebuildOpenAiToolAgentStateAfterCompaction(
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
      ),
    resolveWorkspaceFilesFromInput: (userInput) =>
      pendingWorkspaceFilesFromInput(input.workspaceRoot, userInput),
  }, input.history.map((message) => ({
    role: message.role,
    content: message.content,
    imagePaths: [...message.imagePaths],
  })));
}

export function cloneActiveSkills(skills: OpenAiActiveSkill[]): OpenAiActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}