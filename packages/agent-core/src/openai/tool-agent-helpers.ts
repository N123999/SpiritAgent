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
  buildTodosSystemMessage,
  buildToolAgentMessages,
  buildToolAgentSystemMessage,
  cloneJsonValue,
  continueToolAgentState,
  extractLastAssistantText,
  findLastMatchingIndex,
  findSpiritSystemMessageContent,
  hasBasicInfoSystemMessage,
  hasDreamsSystemMessage,
  hasTodosSystemMessage,
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
import { userMessageContentMatchesInput } from '../runtime/user-turn-timestamp.js';

export {
  buildActiveSkillsSystemMessage,
  buildAgentModeSystemMessage,
  buildBasicInfoSystemMessage,
  buildDreamsSystemMessage,
  buildTodosSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
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
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  todosContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
): OpenAiToolAgentState {
  return startToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      model,
      planMetadata,
      extensionSystemPrompts,
      dreamsContextText,
      todosContextText,
      basicInfo,
      applyPatchFileToolsPromptSection,
      providerWebSearchPromptSection,
    ),
    userInput,
  );
}

export function continueOpenAiToolAgentState(
  history: LlmMessage[],
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  todosContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
): OpenAiToolAgentState {
  return continueToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      model,
      planMetadata,
      extensionSystemPrompts,
      dreamsContextText,
      todosContextText,
      basicInfo,
      applyPatchFileToolsPromptSection,
      providerWebSearchPromptSection,
    ),
  );
}

function buildOpenAiToolAgentMessages(
  history: LlmMessage[],
  assetRoot: string,
  enabledRules: OpenAiEnabledRule[],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[],
  activeSkills: OpenAiActiveSkill[],
  model: string,
  planMetadata: OpenAiPlanMetadata | undefined,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[],
  dreamsContextText: string | undefined,
  todosContextText: string | undefined,
  basicInfo: OpenAiToolAgentBasicInfo | undefined,
  applyPatchFileToolsPromptSection: string | undefined,
  providerWebSearchPromptSection: string | undefined,
): JsonValue[] {
  return buildToolAgentMessages({
    historyMessages: llmHistoryToOpenAiMessages(history, assetRoot),
    enabledRules,
    enabledSkillCatalog,
    activeSkills,
    model,
    ...(planMetadata === undefined ? {} : { planMetadata }),
    extensionSystemPrompts,
    ...(dreamsContextText === undefined ? {} : { dreamsContextText }),
    ...(todosContextText === undefined ? {} : { todosContextText }),
    ...(basicInfo === undefined ? {} : { basicInfo }),
    ...(applyPatchFileToolsPromptSection === undefined
      ? {}
      : { applyPatchFileToolsPromptSection }),
    ...(providerWebSearchPromptSection === undefined
      ? {}
      : { providerWebSearchPromptSection }),
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
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
  dreamsContextText?: string,
  todosContextText?: string,
  basicInfo?: OpenAiToolAgentBasicInfo,
  applyPatchFileToolsPromptSection?: string,
  providerWebSearchPromptSection?: string,
): OpenAiToolAgentState {
  const preservedSpiritSystemMessage = findSpiritSystemMessageContent(retryState.messages);
  const rebuilt = startOpenAiToolAgentState(
    history,
    userInput,
    assetRoot,
    preservedSpiritSystemMessage === undefined ? enabledRules : [],
    preservedSpiritSystemMessage === undefined ? enabledSkillCatalog : [],
    preservedSpiritSystemMessage === undefined ? activeSkills : [],
    model,
    preservedSpiritSystemMessage === undefined ? planMetadata : undefined,
    preservedSpiritSystemMessage === undefined ? extensionSystemPrompts : [],
    preservedSpiritSystemMessage === undefined ? dreamsContextText : undefined,
    preservedSpiritSystemMessage === undefined ? todosContextText : undefined,
    basicInfo,
    applyPatchFileToolsPromptSection,
    providerWebSearchPromptSection,
  );
  if (preservedSpiritSystemMessage !== undefined) {
    const preservedDreams = hasDreamsSystemMessage(preservedSpiritSystemMessage);
    const preservedTodos = hasTodosSystemMessage(preservedSpiritSystemMessage);
    const preservedBasicInfo = hasBasicInfoSystemMessage(preservedSpiritSystemMessage);
    rebuilt.messages[0] = {
      role: 'system',
      content: buildToolAgentSystemMessage(
        model,
        preservedSpiritSystemMessage,
        preservedDreams ? undefined : buildDreamsSystemMessage(dreamsContextText),
        preservedTodos ? undefined : buildTodosSystemMessage(todosContextText),
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
