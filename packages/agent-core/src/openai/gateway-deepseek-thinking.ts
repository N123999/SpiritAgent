import type { JsonObject } from '../ports.js';
import { isDeepSeekV4ReasoningEffortModel } from '../reasoning-effort.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { openAiReasoningEffort } from './openai-compat.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

export function isGatewayDeepSeekModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'deepseek';
}

/** Gateway DeepSeek：经 deepseek providerOptions 控制 thinking（非 openai 命名空间）。 */
export function buildGatewayDeepSeekProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayDeepSeekModel(config.llmVendor, config.model)) {
    return {};
  }

  if (config.vendorExtendedThinking === false) {
    return {
      deepseek: {
        thinking: { type: 'disabled' },
      } as JsonObject,
    };
  }

  const context = {
    provider: 'vercel-ai-gateway' as const,
    model: config.model,
    transportKind: 'openai-compatible' as const,
  };

  if (!isDeepSeekV4ReasoningEffortModel(context)) {
    return {};
  }

  const deepseek: JsonObject = {
    thinking: { type: 'enabled' },
  };
  const effort = openAiReasoningEffort(config);
  if (effort !== undefined && effort !== 'default' && effort !== 'none') {
    deepseek.reasoningEffort = effort;
  }

  return { deepseek };
}
