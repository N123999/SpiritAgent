import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { createOpenResponses } from '@ai-sdk/open-responses';
import {
  createXai,
  type XaiLanguageModelResponsesOptions,
} from '@ai-sdk/xai';

import type { JsonObject } from '../ports.js';
import { createAlibabaResponsesAwareFetch } from './alibaba-responses-fetch.js';
import { createApplyPatchAwareFetch } from './apply-patch-responses-fetch.js';
import { shouldUseAlibabaResponsesNativeTools } from './alibaba-native-tools.js';
import {
  buildResponsesAiSdkTools,
  type OpenAiFunctionToolDefinition,
} from './ai-sdk-message-bridge.js';
import {
  buildApplyPatchFunctionToolDefinition,
  shouldUseApplyPatchFileTools,
  shouldUseApplyPatchFunctionTool,
  shouldUseOpenAiSdkApplyPatchTool,
} from './apply-patch-eligibility.js';
import { resolveProviderWebSearchMode } from './web-search-eligibility.js';
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';

function responsesFetchForConfig(config: OpenResponsesTransportConfig): typeof fetch | undefined {
  if (shouldUseOpenAiSdkApplyPatchTool(config)) {
    return undefined;
  }

  let fetchFn: typeof fetch | undefined;
  if (shouldUseAlibabaResponsesNativeTools(config)) {
    fetchFn = createAlibabaResponsesAwareFetch(config, fetchFn ?? globalThis.fetch);
  }
  if (shouldUseApplyPatchFileTools(config)) {
    fetchFn = createApplyPatchAwareFetch(config, fetchFn ?? globalThis.fetch);
  }

  return fetchFn;
}

export function createOpenAIResponsesProvider(
  config: OpenResponsesTransportConfig,
): OpenAIProvider | undefined {
  if (resolveOpenResponsesSdkProvider(config) !== 'openai') {
    return undefined;
  }

  const applyPatchFetch = responsesFetchForConfig(config);
  return createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
    ...(applyPatchFetch ? { fetch: applyPatchFetch } : {}),
  });
}

export function createResponsesLanguageModel(config: OpenResponsesTransportConfig): unknown {
  const provider = resolveOpenResponsesSdkProvider(config);
  const languageModelId = resolveOpenResponsesLanguageModelId(config);
  if (provider === 'openai') {
    const openai = createOpenAIResponsesProvider(config);
    if (!openai) {
      throw new Error('OpenAI Responses provider 未配置。');
    }
    return openai.responses(languageModelId);
  }

  if (provider === 'xai') {
    return createXaiResponsesProvider(config).responses(languageModelId);
  }

  const applyPatchFetch = responsesFetchForConfig(config);
  const openResponses = createOpenResponses({
    name: config.llmVendor ?? 'spirit-agent',
    url: openResponsesPostUrl(config.baseUrl),
    apiKey: config.apiKey,
    ...(applyPatchFetch ? { fetch: applyPatchFetch } : {}),
  });
  return openResponses(config.model);
}

function createXaiResponsesProvider(config: OpenResponsesTransportConfig) {
  return createXai({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_XAI_BASE_URL,
  });
}

export function buildResponsesGenerateTools(
  config: OpenResponsesTransportConfig,
  normalizedTools: readonly OpenAiFunctionToolDefinition[],
): Record<string, unknown> {
  let merged = buildResponsesAiSdkTools([...normalizedTools]) as Record<string, unknown>;
  if (shouldUseApplyPatchFunctionTool(config)) {
    merged = {
      ...merged,
      ...buildResponsesAiSdkTools([
        buildApplyPatchFunctionToolDefinition() as OpenAiFunctionToolDefinition,
      ]),
    };
  }

  const webSearchMode = resolveProviderWebSearchMode(config);
  const provider = resolveOpenResponsesSdkProvider(config);

  if (provider === 'openai') {
    const openai = createOpenAIResponsesProvider(config);
    if (openai) {
      const sdkTools: Record<string, unknown> = {};
      if (shouldUseOpenAiSdkApplyPatchTool(config)) {
        sdkTools.apply_patch = openai.tools.applyPatch({});
      }
      if (webSearchMode === 'openai-sdk-web-search') {
        sdkTools.web_search = openai.tools.webSearch({});
      }
      if (Object.keys(sdkTools).length > 0) {
        return { ...merged, ...sdkTools };
      }
    }
  }

  if (provider === 'xai' && webSearchMode === 'xai-sdk-web-search') {
    const xai = createXaiResponsesProvider(config);
    return {
      ...merged,
      web_search: xai.tools.webSearch({}),
    };
  }

  return merged;
}

export function buildResponsesProviderOptions(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Record<string, JsonObject> {
  const reasoningEffort = openResponsesReasoningEffort(config);
  const reasoningSummary = resolveOpenResponsesReasoningSummary(config);

  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === 'xai') {
    const xaiOptions = {
      ...(xaiResponsesReasoningEffort(reasoningEffort) !== undefined
        ? { reasoningEffort: xaiResponsesReasoningEffort(reasoningEffort) }
        : {}),
    } satisfies XaiLanguageModelResponsesOptions;

    return Object.keys(xaiOptions).length > 0 ? { xai: xaiOptions as JsonObject } : {};
  }

  if (provider !== 'openai') {
    const providerOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };

    if (config.llmVendor === 'alibaba') {
      providerOptions.enable_thinking = true;
    }

    if (Object.keys(providerOptions).length === 0) {
      return {};
    }

    return {
      [config.llmVendor ?? 'open-responses']: providerOptions,
    };
  }

  const openaiOptions: JsonObject = {
    store: config.store ?? false,
    ...(config.truncation === 'auto' ? { truncation: 'auto' } : { truncation: 'disabled' }),
  };

  if (reasoningEffort !== undefined) {
    openaiOptions.reasoningEffort = reasoningEffort;
  }

  if (reasoningSummary !== undefined) {
    openaiOptions.reasoningSummary = reasoningSummary;
  }

  if (previousResponseId && shouldAttachPreviousResponseId(config)) {
    openaiOptions.previousResponseId = previousResponseId;
  }

  return { openai: openaiOptions };
}

function xaiResponsesReasoningEffort(
  effort: string | undefined,
): XaiLanguageModelResponsesOptions['reasoningEffort'] | undefined {
  return effort === 'low' || effort === 'medium' || effort === 'high' ? effort : undefined;
}

function shouldAttachPreviousResponseId(config: OpenResponsesTransportConfig): boolean {
  const mode = config.previousResponseMode ?? 'disabled';
  if (mode === 'disabled') {
    return false;
  }

  if (mode === 'stored') {
    return config.store === true;
  }

  return mode === 'stateless';
}
