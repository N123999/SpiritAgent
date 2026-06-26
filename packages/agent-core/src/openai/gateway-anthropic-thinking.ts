import type { JsonObject, JsonValue } from '../ports.js';
import type { AnthropicEffort, AnthropicThinkingConfig } from '../anthropic/anthropic-compat.js';
import type { OpenAiLlmVendor, OpenAiTransportConfig } from './openai-compat.js';
import {
  isRoutedAnthropicClaudeModel,
  resolveRoutedAnthropicClaudeCapabilities,
  routedAnthropicClaudeSupportedEfforts,
  routedAnthropicEffortFromReasoningEffort,
  ROUTED_ANTHROPIC_BUDGET_TOKENS_BY_EFFORT,
  type RoutedAnthropicClaudeCapabilities,
} from './routed-anthropic-claude-capabilities.js';

export type GatewayAnthropicThinkingMode = RoutedAnthropicClaudeCapabilities['thinkingMode'];
export type GatewayAnthropicClaudeCapabilities = RoutedAnthropicClaudeCapabilities;

export function normalizeGatewayAnthropicClaudeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, '')
    .replace(/(\d)\.(\d)/g, '$1-$2');
}

export function isGatewayAnthropicClaudeModel(
  llmVendor: OpenAiLlmVendor | undefined,
  model: string,
): boolean {
  if (llmVendor !== 'vercel-ai-gateway') {
    return false;
  }

  return isRoutedAnthropicClaudeModel(model);
}

export function resolveGatewayAnthropicClaudeCapabilities(
  model: string,
): GatewayAnthropicClaudeCapabilities {
  return resolveRoutedAnthropicClaudeCapabilities(model);
}

export function gatewayAnthropicClaudeSupportedEfforts(
  model: string,
): AnthropicEffort[] | undefined {
  return routedAnthropicClaudeSupportedEfforts(model);
}

function buildAdaptiveThinkingConfig(
  capabilities: GatewayAnthropicClaudeCapabilities,
): AnthropicThinkingConfig {
  return {
    type: 'adaptive',
    ...(capabilities.adaptiveDisplay ? { display: capabilities.adaptiveDisplay } : {}),
  };
}

export function buildGatewayAnthropicProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
    return {};
  }

  const capabilities = resolveGatewayAnthropicClaudeCapabilities(config.model);
  const effort = routedAnthropicEffortFromReasoningEffort(
    config.reasoningEffort,
    capabilities.supportedEfforts,
  );

  const anthropic: JsonObject = {
    toolStreaming: true,
  };

  if (capabilities.thinkingMode === 'adaptive') {
    if (config.vendorExtendedThinking === false) {
      anthropic.thinking = { type: 'disabled' } as unknown as JsonValue;
      return { anthropic };
    }
    anthropic.thinking = buildAdaptiveThinkingConfig(capabilities) as unknown as JsonValue;
    if (effort !== undefined) {
      anthropic.effort = effort;
    }
    return { anthropic };
  }

  if (capabilities.thinkingMode === 'budget') {
    if (config.vendorExtendedThinking === false) {
      anthropic.thinking = { type: 'disabled' } as unknown as JsonValue;
      return { anthropic };
    }
    anthropic.thinking = {
      type: 'enabled',
      budgetTokens: ROUTED_ANTHROPIC_BUDGET_TOKENS_BY_EFFORT.high,
    } as unknown as JsonValue;
    return { anthropic };
  }

  return { anthropic };
}
