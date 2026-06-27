import {
  llmMessageTextContent,
  type JsonValue,
  type LlmMessage,
} from '../ports.js';
import {
  llmHistoryToOpenAiMessages,
  llmMessageToOpenAiMessage,
} from './openai-multimodal-messages.js';
import {
  appendToolResultMessage,
  appendToolResultMessages,
  appendUserMessage,
  buildBasicInfoSystemMessage,
  buildDreamsSystemMessage,
  buildLoopModeSystemMessage,
  buildToolAgentMessages,
  buildToolAgentSystemMessage,
  cloneJsonValue,
  continueToolAgentState,
  extractLastAssistantText,
  findLastMatchingIndex,
  findSpiritSystemMessageContent,
  hasBasicInfoSystemMessage,
  hasDreamsSystemMessage,
  hasLoopModeSystemMessage,
  isJsonObject,
  startToolAgentState,
  truncateHistoryForCompaction,
  truncateToolAgentStateForContextRetry,
  type ToolAgentActiveSkill,
  type ToolAgentEnabledRule,
  type ToolAgentEnabledSkillCatalogEntry,
  type ToolAgentExtensionSystemPrompt,
  type ToolAgentBasicInfo,
  type ToolAgentPlanMetadata,
  type ToolAgentState,
  type ToolAgentToolResult,
} from '../tool-agent.js';
import type { ToolAgentMcpToolCatalogSnapshot } from '../mcp/types.js';
import { userMessageContentMatchesInput } from '../runtime/user-turn-timestamp.js';

export {
  buildActiveSkillsBlockContent,
  buildAgentModeSystemMessage,
  buildBasicInfoSystemMessage,
  buildDreamsSystemMessage,
  buildLoopModeSystemMessage,
  buildExtensionsSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildMcpCatalogSystemMessage,
  buildSpiritAgentCoreHostPrompt,
  buildToolAgentHostPrompt,
} from '../tool-agent.js';

export type OpenAiEnabledRule = ToolAgentEnabledRule;
export type OpenAiEnabledSkillCatalogEntry = ToolAgentEnabledSkillCatalogEntry;
export type OpenAiActiveSkillResourceEntry = ToolAgentActiveSkill['resources'][number];
export type OpenAiActiveSkill = ToolAgentActiveSkill;
export type OpenAiPlanMetadata = ToolAgentPlanMetadata;
export type OpenAiExtensionSystemPrompt = ToolAgentExtensionSystemPrompt;
export type OpenAiToolAgentBasicInfo = ToolAgentBasicInfo;
export type OpenAiToolAgentState = ToolAgentState;
export type OpenAiToolResult = ToolAgentToolResult;

export function startOpenAiToolAgentState(
  history: LlmMessage[],
  userInput: string,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
  loopEnabled?: boolean,
  mcpToolCatalog?: ToolAgentMcpToolCatalogSnapshot,
): OpenAiToolAgentState {
  return startToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      model,
      planMetadata,
      extensionSystemPrompts,
      dreamsContextText,
      basicInfo,
      applyPatchFileToolsPromptSection,
      providerWebSearchPromptSection,
      loopEnabled,
      mcpToolCatalog,
    ),
    userInput,
  );
}

export function continueOpenAiToolAgentState(
  history: LlmMessage[],
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
  loopEnabled?: boolean,
  mcpToolCatalog?: ToolAgentMcpToolCatalogSnapshot,
): OpenAiToolAgentState {
  return continueToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      model,
      planMetadata,
      extensionSystemPrompts,
      dreamsContextText,
      basicInfo,
      applyPatchFileToolsPromptSection,
      providerWebSearchPromptSection,
      loopEnabled,
      mcpToolCatalog,
    ),
  );
}

function buildOpenAiToolAgentMessages(
  history: LlmMessage[],
  assetRoot: string,
  enabledRules: OpenAiEnabledRule[],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[],
  model: string,
  planMetadata: OpenAiPlanMetadata | undefined,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[],
  dreamsContextText: string | undefined,
  basicInfo: OpenAiToolAgentBasicInfo | undefined,
  applyPatchFileToolsPromptSection: string | undefined,
  providerWebSearchPromptSection: string | undefined,
  loopEnabled: boolean | undefined,
  mcpToolCatalog: ToolAgentMcpToolCatalogSnapshot | undefined,
): JsonValue[] {
  return buildToolAgentMessages({
    historyMessages: llmHistoryToOpenAiMessages(history, assetRoot),
    enabledRules,
    enabledSkillCatalog,
    ...(mcpToolCatalog === undefined ? {} : { mcpToolCatalog }),
    model,
    ...(planMetadata === undefined ? {} : { planMetadata }),
    extensionSystemPrompts,
    ...(dreamsContextText === undefined ? {} : { dreamsContextText }),
    ...(basicInfo === undefined ? {} : { basicInfo }),
    ...(applyPatchFileToolsPromptSection === undefined
      ? {}
      : { applyPatchFileToolsPromptSection }),
    ...(providerWebSearchPromptSection === undefined
      ? {}
      : { providerWebSearchPromptSection }),
    ...(loopEnabled === true ? { loopEnabled: true } : {}),
  });
}

export function appendOpenAiToolResultMessages(
  state: OpenAiToolAgentState,
  results: OpenAiToolResult[],
): OpenAiToolAgentState {
  return appendToolResultMessages(state, results);
}

export function appendOpenAiToolResultMessage(
  state: OpenAiToolAgentState,
  toolCallId: string,
  content: string,
): OpenAiToolAgentState {
  return appendToolResultMessage(state, toolCallId, content);
}

export function appendOpenAiUserMessage(
  state: OpenAiToolAgentState,
  content: string,
): OpenAiToolAgentState {
  return appendUserMessage(state, content);
}

export function appendOpenAiUserLlmMessage(
  state: OpenAiToolAgentState,
  message: LlmMessage,
  assetRoot = process.cwd(),
): OpenAiToolAgentState {
  if (message.role !== 'user') {
    throw new Error('appendOpenAiUserLlmMessage 仅支持 user message。');
  }

  return {
    messages: [
      ...state.messages.map((item) => cloneJsonValue(item)),
      llmMessageToOpenAiMessage(message, assetRoot),
    ],
    steps: state.steps,
  };
}

export function extractLastOpenAiAssistantText(
  state: OpenAiToolAgentState,
): string | undefined {
  return extractLastAssistantText(state);
}

export function truncateOpenAiToolAgentStateForContextRetry(
  state: OpenAiToolAgentState,
): { state: OpenAiToolAgentState; changed: boolean } {
  return truncateToolAgentStateForContextRetry(state);
}

export function truncateOpenAiHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  return truncateHistoryForCompaction(history);
}

export function rebuildOpenAiToolAgentStateAfterCompaction(
  history: LlmMessage[],
  userInput: string,
  retryState: OpenAiToolAgentState,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
  loopEnabled?: boolean,
  mcpToolCatalog?: ToolAgentMcpToolCatalogSnapshot,
): OpenAiToolAgentState {
  const preservedSpiritSystemMessage = findSpiritSystemMessageContent(retryState.messages);
  const rebuilt = startOpenAiToolAgentState(
    history,
    userInput,
    assetRoot,
    preservedSpiritSystemMessage === undefined ? enabledRules : [],
    preservedSpiritSystemMessage === undefined ? enabledSkillCatalog : [],
    model,
    preservedSpiritSystemMessage === undefined ? planMetadata : undefined,
    preservedSpiritSystemMessage === undefined ? extensionSystemPrompts : [],
    preservedSpiritSystemMessage === undefined ? dreamsContextText : undefined,
    basicInfo,
    applyPatchFileToolsPromptSection,
    providerWebSearchPromptSection,
    loopEnabled,
    preservedSpiritSystemMessage === undefined ? mcpToolCatalog : undefined,
  );
  if (preservedSpiritSystemMessage !== undefined) {
    const preservedDreams = hasDreamsSystemMessage(preservedSpiritSystemMessage);
    const preservedBasicInfo = hasBasicInfoSystemMessage(preservedSpiritSystemMessage);
    const preservedLoop = hasLoopModeSystemMessage(preservedSpiritSystemMessage);
    rebuilt.messages[0] = {
      role: 'system',
      content: buildToolAgentSystemMessage(
        model,
        preservedSpiritSystemMessage,
        preservedDreams ? undefined : buildDreamsSystemMessage(dreamsContextText),
        preservedLoop ? undefined : buildLoopModeSystemMessage(loopEnabled),
        preservedBasicInfo ? undefined : buildBasicInfoSystemMessage(basicInfo),
      ),
    };
  }
  rebuilt.steps = retryState.steps;

  const userIndex = findLastMatchingIndex(
    retryState.messages,
    (message) => isOpenAiUserMessageForInput(message, userInput),
  );

  if (userIndex < 0) {
    return {
      messages: retryState.messages.map((message) => cloneJsonValue(message)),
      steps: retryState.steps,
    };
  }

  rebuilt.messages.push(
    ...retryState.messages.slice(userIndex + 1).map((message) => cloneJsonValue(message)),
  );
  return rebuilt;
}

function isOpenAiUserMessageForInput(message: JsonValue, userInput: string): boolean {
  if (!isJsonObject(message) || message.role !== 'user') {
    return false;
  }

  if (typeof message.content === 'string') {
    return userMessageContentMatchesInput(message.content, userInput);
  }

  if (!Array.isArray(message.content)) {
    return false;
  }

  return message.content.some(
    (part) =>
      isJsonObject(part) &&
      part.type === 'text' &&
      typeof part.text === 'string' &&
      userMessageContentMatchesInput(part.text, userInput),
  );
}

export { llmHistoryToOpenAiMessages, llmMessageToOpenAiMessage };
