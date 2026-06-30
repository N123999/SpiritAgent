import type { LlmTransportConfig } from '../../provider-config.js';
import { transportKindForConfig } from '../../provider-config.js';
import type { OpenAiTransportConfig } from '../../openai/openai-compat.js';

export function shouldUseMoonshotFormulaWebSearch(config: LlmTransportConfig): boolean {
  return isMoonshotAiDirectChatCompletionsConfig(config);
}

function isMoonshotAiDirectChatCompletionsConfig(
  config: LlmTransportConfig,
): config is OpenAiTransportConfig {
  if (transportKindForConfig(config) !== 'openai-compatible') {
    return false;
  }

  const openAiConfig = config as OpenAiTransportConfig;
  if (openAiConfig.llmVendor === 'kimi-code' || openAiConfig.llmVendor === 'vercel-ai-gateway') {
    return false;
  }

  return openAiConfig.llmVendor === 'moonshot-ai';
}

export function isMoonshotFormulaWebSearchTool(
  toolName: string,
  config: LlmTransportConfig,
): boolean {
  return toolName === 'web_search' && shouldUseMoonshotFormulaWebSearch(config);
}
