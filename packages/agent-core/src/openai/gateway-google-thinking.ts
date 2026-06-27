import type { GoogleLanguageModelOptions } from '@ai-sdk/google';

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

function normalizeGoogleGeminiModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

export function isGoogleGemini3Model(model: string): boolean {
  return normalizeGoogleGeminiModelId(model).includes('gemini-3');
}

/** Gemini 3+ 走 thinkingLevel；2.5 及更早走 thinkingBudget。 */
export function isGoogleGeminiThinkingLevelModel(model: string): boolean {
  const normalized = normalizeGoogleGeminiModelId(model);
  return normalized.includes('gemini-3');
}

/** Flash / Flash-Lite 系 Gemini 3+ 支持 API thinkingLevel=minimal（Pro 不支持）。 */
export function isGoogleGeminiMinimalThinkingLevelModel(model: string): boolean {
  if (!isGoogleGeminiThinkingLevelModel(model)) {
    return false;
  }

  const normalized = normalizeGoogleGeminiModelId(model);
  return normalized.includes('flash');
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
): GoogleLanguageModelOptions['thinkingConfig'] | undefined {
  if (effort === undefined) {
    return undefined;
  }

  if (effort === 'minimal') {
    if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
      return { thinkingLevel: 'minimal' };
    }

    return undefined;
  }

  if (effort === 'none') {
    if (isGoogleGeminiThinkingLevelModel(model)) {
      // 代码补全等内部路径仍写 none；Flash 系映射为 API minimal。
      if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
        return { thinkingLevel: 'minimal' };
      }

      return undefined;
    }

    return { thinkingBudget: 0 };
  }

  if (isGoogleGeminiThinkingLevelModel(model)) {
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

  if (isGoogleGeminiMinimalThinkingLevelModel(model)) {
    return ['minimal', 'low', 'medium', 'high'];
  }

  if (isGoogleGeminiThinkingLevelModel(model)) {
    return ['low', 'medium', 'high'];
  }

  return ['none', 'low', 'medium', 'high'];
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
  } satisfies GoogleLanguageModelOptions;

  return {
    google: googleOptions as JsonObject,
  };
}
