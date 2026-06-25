import type { JsonObject, JsonValue } from '../ports.js';
import type { AnthropicEffort, AnthropicThinkingConfig } from '../anthropic/anthropic-compat.js';
import type { OpenAiLlmVendor, OpenAiTransportConfig } from './openai-compat.js';

export type GatewayAnthropicThinkingMode = 'adaptive' | 'budget' | 'none';

export interface GatewayAnthropicClaudeCapabilities {
  thinkingMode: GatewayAnthropicThinkingMode;
  supportedEfforts: readonly AnthropicEffort[];
  adaptiveDisplay?: 'summarized';
}

const LEGACY_BUDGET_EFFORTS: readonly AnthropicEffort[] = ['low', 'medium', 'high'];

const BUDGET_TOKENS_BY_EFFORT: Record<'low' | 'medium' | 'high', number> = {
  low: 4_000,
  medium: 8_000,
  high: 12_000,
};

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

  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('anthropic/claude-');
}

export function resolveGatewayAnthropicClaudeCapabilities(
  model: string,
): GatewayAnthropicClaudeCapabilities {
  const modelId = normalizeGatewayAnthropicClaudeModelId(model);

  if (modelId.includes('claude-opus-4-7') || modelId.includes('claude-opus-4-8')) {
    return {
      thinkingMode: 'adaptive',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      adaptiveDisplay: 'summarized',
    };
  }

  if (modelId.includes('claude-opus-4-6')) {
    return {
      thinkingMode: 'adaptive',
      supportedEfforts: ['low', 'medium', 'high', 'max'],
    };
  }

  if (modelId.includes('claude-sonnet-4-6')) {
    return {
      thinkingMode: 'adaptive',
      supportedEfforts: ['low', 'medium', 'high'],
    };
  }

  if (isLegacyGatewayAnthropicClaudeModel(modelId)) {
    return {
      thinkingMode: 'budget',
      supportedEfforts: LEGACY_BUDGET_EFFORTS,
    };
  }

  return {
    thinkingMode: 'none',
    supportedEfforts: [],
  };
}

export function gatewayAnthropicClaudeSupportedEfforts(
  model: string,
): AnthropicEffort[] | undefined {
  if (!model.trim().toLowerCase().startsWith('anthropic/claude-')) {
    return undefined;
  }

  const capabilities = resolveGatewayAnthropicClaudeCapabilities(model);
  if (capabilities.supportedEfforts.length === 0) {
    return undefined;
  }

  return [...capabilities.supportedEfforts];
}

function isLegacyGatewayAnthropicClaudeModel(modelId: string): boolean {
  if (!modelId.includes('claude')) {
    return false;
  }

  return (
    modelId.includes('haiku-4-5')
    || modelId.includes('opus-4-5')
    || modelId.includes('sonnet-4-5')
    || /claude-opus-4(?:-|$)/.test(modelId)
    || /claude-sonnet-4(?:-|$)/.test(modelId)
    || modelId.includes('claude-opus-4-1')
  );
}

function anthropicEffortFromConfigReasoningEffort(
  reasoningEffort: OpenAiTransportConfig['reasoningEffort'],
  supportedEfforts: readonly AnthropicEffort[],
): AnthropicEffort | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'default') {
    return undefined;
  }

  const effort = reasoningEffort as AnthropicEffort;
  return supportedEfforts.includes(effort) ? effort : undefined;
}

function buildAdaptiveThinkingConfig(
  capabilities: GatewayAnthropicClaudeCapabilities,
): AnthropicThinkingConfig {
  return {
    type: 'adaptive',
    ...(capabilities.adaptiveDisplay ? { display: capabilities.adaptiveDisplay } : {}),
  };
}

function buildBudgetThinkingConfig(effort: AnthropicEffort): AnthropicThinkingConfig {
  const budgetKey = effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'high';
  return {
    type: 'enabled',
    budgetTokens: BUDGET_TOKENS_BY_EFFORT[budgetKey],
  };
}

export function buildGatewayAnthropicProviderOptions(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): Record<string, JsonObject> {
  if (!isGatewayAnthropicClaudeModel(config.llmVendor, config.model)) {
    return {};
  }

  const capabilities = resolveGatewayAnthropicClaudeCapabilities(config.model);
  const effort = anthropicEffortFromConfigReasoningEffort(
    config.reasoningEffort,
    capabilities.supportedEfforts,
  );

  const anthropic: JsonObject = {
    toolStreaming: true,
  };

  if (capabilities.thinkingMode === 'adaptive') {
    anthropic.thinking = buildAdaptiveThinkingConfig(capabilities) as unknown as JsonValue;
    if (effort !== undefined) {
      anthropic.effort = effort;
    }
    return { anthropic };
  }

  if (capabilities.thinkingMode === 'budget' && effort !== undefined) {
    anthropic.thinking = buildBudgetThinkingConfig(effort) as unknown as JsonValue;
    anthropic.effort = effort;
    return { anthropic };
  }

  return { anthropic };
}
