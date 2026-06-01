export {
  type OpenResponsesTransportConfig,
  type OpenResponsesSdkProvider,
  type OpenResponsesRequestTrace,
  type OpenResponsesRequestTraceKind,
  type OpenResponsesPreviousResponseMode,
  type OpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
  openResponsesReasoningEffort,
  resolveOpenResponsesReasoningSummary,
  openResponsesReasoningTrace,
  buildOpenResponsesTraceExtras,
  buildOpenResponsesRequestTrace,
  normalizeOpenResponsesApiBase,
  openResponsesPostUrl,
} from './responses-compat.js';
export { AiSdkOpenResponsesTransport } from './ai-sdk-transport.js';
export { createApplyPatchAwareFetch } from './apply-patch-responses-fetch.js';
export {
  APPLY_PATCH_HOST_TOOL_NAME,
  type ApplyPatchOperation,
  type ApplyPatchOperationType,
  filterBuiltinFileToolsForApplyPatch,
  buildApplyPatchFileToolsPromptSection,
  shouldUseNativeApplyPatchRequestItems,
  filterLegacyHostFileToolDefinitions,
  isLegacyHostFileToolName,
  isOpenAiGptModelAtLeast51,
  normalizeGatewayOpenAiModelId,
  parseOpenAiGptModelVersion,
  shouldUseApplyPatchFileTools,
  shouldUseOpenAiApplyPatchTool,
} from './apply-patch-eligibility.js';
