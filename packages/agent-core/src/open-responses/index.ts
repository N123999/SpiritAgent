export {
  type OpenResponsesTransportConfig,
  type OpenResponsesSdkProvider,
  type OpenResponsesRequestTrace,
  type OpenResponsesRequestTraceKind,
  type OpenResponsesPreviousResponseMode,
  type OpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
  resolveOpenResponsesLanguageModelId,
  isGatewayOpenAiRoutedModel,
  openResponsesReasoningEffort,
  resolveOpenResponsesReasoningSummary,
  openResponsesReasoningTrace,
  buildOpenResponsesTraceExtras,
  buildOpenResponsesRequestTrace,
  normalizeOpenResponsesApiBase,
  openResponsesPostUrl,
} from './responses-compat.js';
export { AiSdkOpenResponsesTransport } from './ai-sdk-transport.js';
export {
  buildResponsesGenerateTools,
  createOpenAIResponsesProvider,
} from './model-factory.js';
export { createApplyPatchAwareFetch } from './apply-patch-responses-fetch.js';
export {
  APPLY_PATCH_HOST_TOOL_NAME,
  type ApplyPatchOperation,
  type ApplyPatchOperationType,
  filterBuiltinFileToolsForApplyPatch,
  buildApplyPatchFileToolsPromptSection,
  shouldUseNativeApplyPatchRequestItems,
  shouldUseOpenAiSdkApplyPatchTool,
  filterLegacyHostFileToolDefinitions,
  isLegacyHostFileToolName,
  isOpenAiGptModelAtLeast51,
  normalizeGatewayOpenAiModelId,
  parseOpenAiGptModelVersion,
  shouldUseApplyPatchFileTools,
  shouldUseApplyPatchFunctionTool,
  buildApplyPatchFunctionToolDefinition,
  buildApplyPatchResponsesFunctionToolDefinition,
  hasApplyPatchToolInResponsesTools,
  isApplyPatchFunctionToolDefinition,
  shouldUseOpenAiApplyPatchTool,
} from './apply-patch-eligibility.js';
export {
  ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES,
  buildAlibabaChatCompletionsExtraBody,
  buildAlibabaNativeToolsPromptSection,
  buildAlibabaResponsesBuiltinTools,
  mergeAlibabaResponsesBuiltinTools,
  shouldUseAlibabaChatCompletionsNativeTools,
  shouldUseAlibabaNativeTools,
  shouldUseAlibabaResponsesNativeTools,
  type AlibabaResponsesBuiltinToolType,
} from './alibaba-native-tools.js';
export {
  buildProviderWebSearchPromptSection,
  buildWebSearchResponsesTraceToolEntry,
  resolveProviderWebSearchMode,
  shouldUseProviderWebSearch,
  type ProviderWebSearchMode,
} from './web-search-eligibility.js';
