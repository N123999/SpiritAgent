import type { JsonObject, JsonValue } from '../ports.js';
import { isCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import {
  buildGatewayGoogleProviderOptions,
  isGatewayGoogleGeminiModel,
} from './gateway-google-thinking.js';
import { buildGatewayAlibabaProviderOptions } from './gateway-alibaba-thinking.js';
import { buildGatewayMinimaxProviderOptions } from './gateway-minimax-thinking.js';
import { isGatewayAnthropicClaudeModel } from './gateway-anthropic-thinking.js';

/** 解析 Gateway 模型 ID 的上游 slug，如 `deepseek/deepseek-v3` → `deepseek`。 */
export function parseGatewayUpstreamSlug(model: string): string | undefined {
  const normalized = model.trim();
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) {
    return undefined;
  }
  return normalized.slice(0, slashIndex).toLowerCase();
}

function openAiNoneReasoningOptions(): Record<string, JsonObject> {
  return {
    openai: {
      reasoningEffort: 'none',
      reasoningSummary: 'off',
    },
  };
}

function thinkingTypeDisabledOptions(providerKey: string): Record<string, JsonObject> {
  return {
    [providerKey]: {
      thinking: {
        type: 'disabled',
      },
    } as JsonObject,
  };
}

/**
 * Gateway 无统一关闭思考开关；按 model 上游 slug 注入与各直连厂商相同的 providerOptions。
 * 仅用于 `transportRequestProfile: 'code-completion'`。
 */
export function buildGatewayCodeCompletionProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'transportRequestProfile'
  >,
): Record<string, JsonObject> {
  const slug = parseGatewayUpstreamSlug(config.model);

  if (slug === undefined) {
    return openAiNoneReasoningOptions();
  }

  if (slug === 'anthropic' && isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
    return {
      anthropic: {
        thinking: { type: 'disabled' } as JsonValue,
        toolStreaming: true,
      },
    };
  }

  if (slug === 'google' && isGatewayGoogleGeminiModel(config.llmVendor, config.model)) {
    return buildGatewayGoogleProviderOptions(config, 'none');
  }

  switch (slug) {
    case 'openai':
      return openAiNoneReasoningOptions();
    case 'deepseek':
      return thinkingTypeDisabledOptions('deepseek');
    case 'moonshotai':
      return thinkingTypeDisabledOptions('moonshotai');
    case 'xai':
      return {
        xai: {
          reasoningEffort: 'none',
        } as JsonObject,
      };
    case 'zai':
      return thinkingTypeDisabledOptions('zai');
    case 'alibaba':
      return buildGatewayAlibabaProviderOptions({
        ...config,
        vendorExtendedThinking: false,
      });
    case 'minimax':
      return buildGatewayMinimaxProviderOptions({
        ...config,
        vendorExtendedThinking: false,
      });
    case 'xiaomi':
      return openAiNoneReasoningOptions();
    default:
      return openAiNoneReasoningOptions();
  }
}

export function shouldUseGatewayCodeCompletionProviderOptions(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'transportRequestProfile'>,
): boolean {
  return config.llmVendor === 'vercel-ai-gateway' && isCodeCompletionTransportProfile(config);
}
