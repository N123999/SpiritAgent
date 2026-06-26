import { createGateway } from '@ai-sdk/gateway';
import { createAzure } from '@ai-sdk/azure';
import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';
import { createOpenResponses } from '@ai-sdk/open-responses';
import {
  createXai,
  type XaiLanguageModelResponsesOptions,
} from '@ai-sdk/xai';

import { getLlmFetch } from '../llm-fetch.js';
import type { JsonObject } from '../ports.js';
import { createAlibabaResponsesAwareFetch } from './alibaba-responses-fetch.js';
import { createApplyPatchAwareFetch } from './apply-patch-responses-fetch.js';
import { createOpenRouterReasoningAwareFetch } from './openrouter-reasoning-responses-fetch.js';
import {
  resolveBedrockMantleOpenResponsesApiKey,
  wrapFetchForBedrockMantleIamAuth,
} from './bedrock-mantle-auth-fetch.js';
import { shouldUseAlibabaResponsesBuiltInTools } from './alibaba-built-in-tools.js';
import { isCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
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
import {
  buildGatewayAnthropicProviderOptions,
  isGatewayAnthropicClaudeModel,
} from '../openai/gateway-anthropic-thinking.js';
import {
  buildGatewayCodeCompletionProviderOptions,
  shouldUseGatewayCodeCompletionProviderOptions,
} from '../openai/gateway-code-completion-thinking.js';
import {
  buildGatewayDeepSeekProviderOptions,
  isGatewayDeepSeekModel,
} from '../openai/gateway-deepseek-thinking.js';
import {
  buildGatewayMoonshotProviderOptions,
  isGatewayMoonshotModel,
} from '../openai/moonshot-thinking-switch.js';
import {
  buildGatewayGoogleProviderOptions,
  isGatewayGoogleGeminiModel,
} from '../openai/gateway-google-thinking.js';
import { isOpenRouterAnthropicClaudeModel } from '../openai/openrouter-anthropic-reasoning.js';
import { buildGatewayWebSearchTool, shouldUseGatewayWebSearch } from './gateway-web-search.js';
import { resolveProviderWebSearchMode } from './web-search-eligibility.js';
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesReasoningSummary,
  resolveOpenResponsesSdkProvider,
  resolveAzureResourceName,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';

/** 本地 contract smoke 将 …/v1 mock 映射到 Gateway SDK 的 …/v3/ai。 */
function resolveGatewaySdkBaseUrl(config: OpenResponsesTransportConfig): string | undefined {
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return undefined;
    }
    url.pathname = '/v3/ai';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return undefined;
  }
}

function responsesFetchForConfig(config: OpenResponsesTransportConfig): typeof fetch {
  let fetchFn: typeof fetch = getLlmFetch();
  if (shouldUseAlibabaResponsesBuiltInTools(config)) {
    fetchFn = createAlibabaResponsesAwareFetch(config, fetchFn);
  }
  fetchFn = createOpenRouterReasoningAwareFetch(config, fetchFn);
  if (shouldUseApplyPatchFileTools(config)) {
    fetchFn = createApplyPatchAwareFetch(config, fetchFn);
  }
  return wrapFetchForBedrockMantleIamAuth(config, fetchFn);
}

export function createOpenAIResponsesProvider(
  config: OpenResponsesTransportConfig,
): OpenAIProvider | undefined {
  if (resolveOpenResponsesSdkProvider(config) !== 'openai') {
    return undefined;
  }

  return createOpenAI({
    apiKey: resolveBedrockMantleOpenResponsesApiKey(config),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
    fetch: responsesFetchForConfig(config),
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

  if (provider === 'azure') {
    return createAzureResponsesProvider(config)(languageModelId);
  }

  // Gateway Perplexity 须走 @ai-sdk/gateway v3 language-model；fetch 仍须走 responsesFetchForConfig 以剥离 apply_patch 响应
  if (shouldUseGatewayWebSearch(config)) {
    const gatewayBaseUrl = resolveGatewaySdkBaseUrl(config);
    return createGateway({
      apiKey: config.apiKey,
      fetch: responsesFetchForConfig(config),
      ...(gatewayBaseUrl !== undefined ? { baseURL: gatewayBaseUrl } : {}),
    }).languageModel(config.model);
  }

  const openResponses = createOpenResponses({
    name: config.llmVendor ?? 'spirit-agent',
    url: openResponsesPostUrl(config.baseUrl),
    apiKey: config.apiKey,
    fetch: responsesFetchForConfig(config),
  });
  return openResponses(config.model);
}

function createXaiResponsesProvider(config: OpenResponsesTransportConfig) {
  return createXai({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? DEFAULT_XAI_BASE_URL,
    fetch: getLlmFetch(),
  });
}

function createAzureResponsesProvider(config: OpenResponsesTransportConfig) {
  return createAzure({
    apiKey: config.apiKey,
    resourceName: resolveAzureResourceName(config),
    fetch: responsesFetchForConfig(config),
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

  if (webSearchMode === 'gateway-sdk-web-search') {
    return {
      ...merged,
      web_search: buildGatewayWebSearchTool(config),
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

  if (shouldUseGatewayWebSearch(config)) {
    if (shouldUseGatewayCodeCompletionProviderOptions(config)) {
      return buildGatewayCodeCompletionProviderOptions(config);
    }

    if (isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
      return buildGatewayAnthropicProviderOptions(config);
    }

    if (isGatewayGoogleGeminiModel(config.llmVendor, config.model)) {
      return buildGatewayGoogleProviderOptions(config, reasoningEffort);
    }

    if (isGatewayDeepSeekModel(config.llmVendor, config.model)) {
      return buildGatewayDeepSeekProviderOptions(config);
    }

    if (isGatewayMoonshotModel(config.llmVendor, config.model)) {
      const moonshotOptions = buildGatewayMoonshotProviderOptions(config);
      if (Object.keys(moonshotOptions).length > 0) {
        return moonshotOptions;
      }
    }

    // Gateway v3 language-model 原样转发 providerOptions；OpenAI 路由模型须用 openai 命名空间（见 Vercel AI Gateway reasoning 文档）。
    const openaiOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };
    const result = Object.keys(openaiOptions).length > 0 ? { openai: openaiOptions } : {};
    return result;
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === 'xai') {
    const xaiOptions = {
      ...(xaiResponsesReasoningEffort(reasoningEffort) !== undefined
        ? { reasoningEffort: xaiResponsesReasoningEffort(reasoningEffort) }
        : {}),
    } satisfies XaiLanguageModelResponsesOptions;

    return Object.keys(xaiOptions).length > 0 ? { xai: xaiOptions as JsonObject } : {};
  }

  if (provider === 'azure') {
    const azureOptions: JsonObject = {
      store: config.store ?? false,
      ...(config.truncation === 'auto' ? { truncation: 'auto' } : { truncation: 'disabled' }),
    };

    if (reasoningEffort !== undefined) {
      azureOptions.reasoningEffort = reasoningEffort;
    }

    if (reasoningSummary !== undefined) {
      azureOptions.reasoningSummary = reasoningSummary;
    }

    if (previousResponseId && shouldAttachPreviousResponseId(config)) {
      azureOptions.previousResponseId = previousResponseId;
    }

    return { azure: azureOptions };
  }

  if (provider !== 'openai') {
    if (isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model)) {
      return {};
    }

    const providerOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };

    if (config.llmVendor === 'alibaba') {
      providerOptions.enable_thinking = !isCodeCompletionTransportProfile(config);
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
