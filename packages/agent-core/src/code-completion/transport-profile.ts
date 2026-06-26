import type { AnthropicTransportConfig } from '../anthropic/anthropic-compat.js';
import type { BedrockTransportConfig } from '../bedrock/bedrock-compat.js';
import type { OpenAiLlmVendor, OpenAiTransportConfig } from '../openai/openai-compat.js';
import type { OpenResponsesTransportConfig } from '../open-responses/responses-compat.js';
import type { TransportRequestProfile } from '../llm-provider-shared.js';
import type { LlmTransportConfig } from '../provider-config.js';
import {
  isAnthropicTransportConfig,
  isBedrockTransportConfig,
  isOpenAiCompatibleTransportConfig,
  isOpenResponsesTransportConfig,
} from '../provider-config.js';

/** 经 `thinking.type` 关闭 extended thinking 的 OpenAI-compatible 直连厂商（后续 Phase 逐步扩展）。 */
const OPENAI_COMPAT_THINKING_TYPE_VENDORS = new Set<OpenAiLlmVendor>([
  'deepseek',
  'moonshot-ai',
]);

export function isCodeCompletionTransportProfile(
  config: { transportRequestProfile?: TransportRequestProfile },
): boolean {
  return config.transportRequestProfile === 'code-completion';
}

function withCodeCompletionProfile<T extends LlmTransportConfig>(config: T): T {
  return {
    ...config,
    transportRequestProfile: 'code-completion',
  };
}

/** 经 reasoningEffort none 关闭 Gemini thinking 的 OpenAI-compatible 直连厂商。 */
const OPENAI_COMPAT_GOOGLE_REASONING_NONE_VENDORS = new Set<OpenAiLlmVendor>([
  'google',
  'google-vertex-ai',
]);

function applyOpenAiCompatibleCodeCompletionProfile(
  config: OpenAiTransportConfig,
): OpenAiTransportConfig {
  const profiled = withCodeCompletionProfile(config);
  const vendor = profiled.llmVendor;
  if (vendor === 'openai' || vendor === 'xai') {
    return {
      ...profiled,
      reasoningEffort: 'none',
    };
  }
  if (vendor !== undefined && OPENAI_COMPAT_GOOGLE_REASONING_NONE_VENDORS.has(vendor)) {
    return {
      ...profiled,
      reasoningEffort: 'none',
    };
  }
  if (vendor !== undefined && OPENAI_COMPAT_THINKING_TYPE_VENDORS.has(vendor)) {
    return {
      ...profiled,
      vendorExtendedThinking: false,
    };
  }
  return profiled;
}

function applyAnthropicCodeCompletionProfile(
  config: AnthropicTransportConfig,
): AnthropicTransportConfig {
  return {
    ...withCodeCompletionProfile(config),
    thinking: { type: 'disabled' },
  };
}

function applyOpenResponsesCodeCompletionProfile(
  config: OpenResponsesTransportConfig,
): OpenResponsesTransportConfig {
  const profiled = withCodeCompletionProfile(config);
  if (profiled.llmVendor === 'openai' || profiled.llmVendor === 'xai') {
    return {
      ...profiled,
      reasoningEffort: 'none',
      reasoningSummary: 'off',
    };
  }
  return profiled;
}

function applyBedrockCodeCompletionProfile(
  config: BedrockTransportConfig,
): BedrockTransportConfig {
  return withCodeCompletionProfile(config);
}

/** 将任意 transport config 标记为代码补全请求画像，并按 transportKind / llmVendor 写入关闭思考所需字段。 */
export function applyCodeCompletionTransportProfile(
  config: LlmTransportConfig,
): LlmTransportConfig {
  if (isAnthropicTransportConfig(config)) {
    return applyAnthropicCodeCompletionProfile(config);
  }
  if (isOpenResponsesTransportConfig(config)) {
    return applyOpenResponsesCodeCompletionProfile(config);
  }
  if (isBedrockTransportConfig(config)) {
    return applyBedrockCodeCompletionProfile(config);
  }
  if (isOpenAiCompatibleTransportConfig(config)) {
    return applyOpenAiCompatibleCodeCompletionProfile(config);
  }
  return withCodeCompletionProfile(config);
}
