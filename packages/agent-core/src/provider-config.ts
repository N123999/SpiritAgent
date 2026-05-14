import type { AnthropicTransportConfig } from './anthropic/anthropic-compat.js';
import type { OpenAiTransportConfig } from './openai/openai-compat.js';
import type { LlmTransportKind } from './llm-provider-shared.js';

export type LlmTransportConfig = OpenAiTransportConfig | AnthropicTransportConfig;

export function transportKindForConfig(config: LlmTransportConfig): LlmTransportKind {
  return config.transportKind ?? 'openai-compatible';
}

export function isAnthropicTransportConfig(
  config: LlmTransportConfig | undefined,
): config is AnthropicTransportConfig {
  return config?.transportKind === 'anthropic';
}

export function isOpenAiCompatibleTransportConfig(
  config: LlmTransportConfig | undefined,
): config is OpenAiTransportConfig {
  return !config || config.transportKind === undefined || config.transportKind === 'openai-compatible';
}
