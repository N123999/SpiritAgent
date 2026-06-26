import type { AnthropicEffort } from '../anthropic/anthropic-compat.js';
import type { OpenAiTransportConfig } from './openai-compat.js';

export type RoutedAnthropicThinkingMode = 'adaptive' | 'budget' | 'none';

export interface RoutedAnthropicClaudeCapabilities {
  thinkingMode: RoutedAnthropicThinkingMode;
  supportedEfforts: readonly AnthropicEffort[];
  adaptiveDisplay?: 'summarized';
}

export const ROUTED_ANTHROPIC_BUDGET_TOKENS_BY_EFFORT: Record<'low' | 'medium' | 'high', number> = {
  low: 4_000,
  medium: 8_000,
  high: 12_000,
};

export function normalizeRoutedAnthropicClaudeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, '')
    .replace(/(\d)\.(\d)/g, '$1-$2');
}

export function isRoutedAnthropicClaudeModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('anthropic/claude-');
}

export function resolveRoutedAnthropicClaudeCapabilities(
  model: string,
): RoutedAnthropicClaudeCapabilities {
  const modelId = normalizeRoutedAnthropicClaudeModelId(model);

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

  if (isLegacyRoutedAnthropicClaudeModel(modelId)) {
    return {
      thinkingMode: 'budget',
      supportedEfforts: [],
    };
  }

  return {
    thinkingMode: 'none',
    supportedEfforts: [],
  };
}

export function routedAnthropicClaudeSupportedEfforts(
  model: string,
): AnthropicEffort[] | undefined {
  if (!isRoutedAnthropicClaudeModel(model)) {
    return undefined;
  }

  const capabilities = resolveRoutedAnthropicClaudeCapabilities(model);
  if (capabilities.supportedEfforts.length === 0) {
    return undefined;
  }

  return [...capabilities.supportedEfforts];
}

function isLegacyRoutedAnthropicClaudeModel(modelId: string): boolean {
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

export function routedAnthropicEffortFromReasoningEffort(
  reasoningEffort: OpenAiTransportConfig['reasoningEffort'],
  supportedEfforts: readonly AnthropicEffort[],
): AnthropicEffort | undefined {
  if (reasoningEffort === undefined || reasoningEffort === 'default') {
    return undefined;
  }

  const effort = reasoningEffort as AnthropicEffort;
  return supportedEfforts.includes(effort) ? effort : undefined;
}
