import type { JsonObject } from '../ports.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

/** 文档：https://mimo.mi.com/docs/en-US/quick-start/usage-guide/other/deep-thinking */
function normalizeXiaomiModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

/** mimo-v2-flash 无 deep thinking 模式；其余 mimo-v* 向前兼容。 */
export function isXiaomiThinkingSwitchEligibleModel(model: string): boolean {
  const id = normalizeXiaomiModelId(model);
  if (id === 'mimo-v2-flash' || id.startsWith('mimo-v2-flash-')) {
    return false;
  }
  return id.startsWith('mimo-v');
}

export function isGatewayXiaomiModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'xiaomi';
}

/** Gateway Xiaomi MiMo：经 xiaomi 命名空间注入 thinking.type（非 openai 命名空间）。 */
export function buildGatewayXiaomiProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayXiaomiModel(config.llmVendor, config.model)) {
    return {};
  }
  if (!isXiaomiThinkingSwitchEligibleModel(config.model)) {
    return {};
  }

  return {
    xiaomi: {
      thinking: {
        type: config.vendorExtendedThinking === false ? 'disabled' : 'enabled',
      },
    } as JsonObject,
  };
}
