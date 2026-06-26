import type { JsonObject } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import type { OpenAiLlmVendor, OpenAiTransportConfig } from './openai-compat.js';
import {
  isRoutedAnthropicClaudeModel,
  resolveRoutedAnthropicClaudeCapabilities,
  ROUTED_ANTHROPIC_BUDGET_TOKENS_BY_EFFORT,
  routedAnthropicEffortFromReasoningEffort,
} from './routed-anthropic-claude-capabilities.js';
import type { OpenResponsesTransportConfig } from '../open-responses/responses-compat.js';

export type OpenRouterClaudeReasoningConfig = Pick<
  OpenAiTransportConfig,
  'llmVendor' | 'model' | 'reasoningEffort' | 'vendorExtendedThinking'
>;

export function isOpenRouterAnthropicClaudeModel(
  llmVendor: OpenAiLlmVendor | undefined,
  model: string,
): boolean {
  return llmVendor === 'openrouter' && isRoutedAnthropicClaudeModel(model);
}

export function buildOpenRouterClaudeReasoningBody(
  config: OpenRouterClaudeReasoningConfig,
): JsonObject | undefined {
  if (!isOpenRouterAnthropicClaudeModel(config.llmVendor, config.model)) {
    return undefined;
  }

  if (config.reasoningEffort === 'none') {
    return { effort: 'none' };
  }

  const capabilities = resolveRoutedAnthropicClaudeCapabilities(config.model);
  const effort = routedAnthropicEffortFromReasoningEffort(
    config.reasoningEffort,
    capabilities.supportedEfforts,
  );

  if (capabilities.thinkingMode === 'adaptive') {
    if (config.vendorExtendedThinking === false) {
      return { enabled: false };
    }
    if (effort !== undefined) {
      return { enabled: true, effort };
    }
    return { enabled: true };
  }

  if (capabilities.thinkingMode === 'budget') {
    if (config.vendorExtendedThinking === false) {
      return { enabled: false };
    }
    return {
      enabled: true,
      max_tokens: ROUTED_ANTHROPIC_BUDGET_TOKENS_BY_EFFORT.high,
    };
  }

  return undefined;
}

export function shouldInjectOpenRouterClaudeReasoning(
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): boolean {
  return buildOpenRouterClaudeReasoningBody(config) !== undefined;
}

export function patchResponsesRequestBodyForOpenRouterReasoning(
  body: JsonObject,
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): void {
  const reasoning = buildOpenRouterClaudeReasoningBody(config);
  if (reasoning === undefined) {
    return;
  }

  body.reasoning = reasoning;
  delete body.reasoning_effort;
}

export function tryPatchOpenRouterClaudeChatCompletionBody(
  body: unknown,
  config: OpenRouterClaudeReasoningConfig,
): boolean {
  if (!isJsonObject(body as JsonObject)) {
    return false;
  }

  const reasoning = buildOpenRouterClaudeReasoningBody(config);
  if (reasoning === undefined) {
    return false;
  }

  const record = body as JsonObject;
  record.reasoning = reasoning;
  delete record.reasoning_effort;
  return true;
}
