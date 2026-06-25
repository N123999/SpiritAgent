import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';

import type { JsonObject } from '../ports.js';
import type { OpenAiLlmVendor, OpenAiTransportConfig } from './openai-compat.js';

export function isGatewayGoogleGeminiModel(
  llmVendor: OpenAiLlmVendor | undefined,
  model: string,
): boolean {
  if (llmVendor !== 'vercel-ai-gateway') {
    return false;
  }

  return model.trim().toLowerCase().startsWith('google/gemini-');
}

export function isGoogleGemini3Model(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes('gemini-3');
}

function googleGemini25ThinkingBudgetForEffort(
  effort: string,
): number | undefined {
  switch (effort) {
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 8192;
    default:
      return undefined;
  }
}

export function buildGoogleThinkingConfigForEffort(
  model: string,
  effort: string | undefined,
): GoogleGenerativeAIProviderOptions['thinkingConfig'] | undefined {
  if (effort === undefined) {
    return undefined;
  }

  if (effort === 'none') {
    if (isGoogleGemini3Model(model)) {
      return { thinkingLevel: 'minimal' };
    }

    return { thinkingBudget: 0 };
  }

  if (isGoogleGemini3Model(model)) {
    if (effort === 'low' || effort === 'medium' || effort === 'high') {
      return {
        thinkingLevel: effort,
        includeThoughts: true,
      };
    }

    return undefined;
  }

  const thinkingBudget = googleGemini25ThinkingBudgetForEffort(effort);
  if (thinkingBudget === undefined) {
    return undefined;
  }

  return {
    thinkingBudget,
    includeThoughts: thinkingBudget > 0,
  };
}

export function gatewayGoogleGeminiSupportedEfforts(
  model: string,
): readonly string[] | undefined {
  const normalized = model.trim().toLowerCase();
  if (!normalized.startsWith('google/gemini-')) {
    return undefined;
  }

  return ['low', 'medium', 'high'];
}

export function buildGatewayGoogleProviderOptions(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
  effort: string | undefined,
): Record<string, JsonObject> {
  if (!isGatewayGoogleGeminiModel(config.llmVendor, config.model)) {
    return {};
  }

  const thinkingConfig = buildGoogleThinkingConfigForEffort(config.model, effort);
  if (thinkingConfig === undefined) {
    return {};
  }

  const googleOptions = {
    thinkingConfig,
  } satisfies GoogleGenerativeAIProviderOptions;

  return {
    google: googleOptions as JsonObject,
  };
}
