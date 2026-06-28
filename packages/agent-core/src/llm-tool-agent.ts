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
  appendOpenAiToolResultMessage as appendLlmToolResultMessage,
  appendOpenAiToolResultMessages as appendLlmToolResultMessages,
  appendOpenAiUserLlmMessage as appendLlmUserLlmMessage,
  appendOpenAiUserMessage as appendLlmUserMessage,
  continueOpenAiToolAgentState as continueLlmToolAgentState,
  extractLastOpenAiAssistantText as extractLastLlmAssistantText,
  rebuildOpenAiToolAgentStateAfterCompaction as rebuildLlmToolAgentStateAfterCompaction,
  startOpenAiToolAgentState as startLlmToolAgentState,
  truncateOpenAiHistoryForCompaction as truncateLlmHistoryForCompaction,
  truncateOpenAiToolAgentStateForContextRetry as truncateLlmToolAgentStateForContextRetry,
} from './openai/tool-agent-helpers.js';
export { formatActiveSkillUserMessageMeta } from './runtime/user-turn-timestamp.js';
export {
  assistantToolCallMessageFromState,
  assistantToolCallMessageFromState as assistantToolCallMessageFromLlmState,
  finalAssistantHistoryMessageFromState,
  finalAssistantHistoryMessageFromState as finalAssistantHistoryMessageFromLlmState,
} from './tool-agent.js';

export type {
  OpenAiActiveSkill as LlmActiveSkill,
  OpenAiActiveSkillResourceEntry as LlmActiveSkillResourceEntry,
  OpenAiEnabledRule as LlmEnabledRule,
  OpenAiEnabledSkillCatalogEntry as LlmEnabledSkillCatalogEntry,
  OpenAiExtensionSystemPrompt as LlmExtensionSystemPrompt,
  OpenAiPlanMetadata as LlmPlanMetadata,
  OpenAiToolAgentBasicInfo as LlmToolAgentBasicInfo,
  OpenAiToolAgentState as LlmToolAgentState,
  OpenAiToolResult as LlmToolResult,
} from './openai/tool-agent-helpers.js';
