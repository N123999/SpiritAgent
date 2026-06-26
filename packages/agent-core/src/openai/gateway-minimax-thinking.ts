import type { JsonObject } from '../ports.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

/** 文档：https://platform.minimax.io/docs/api-reference/text-openai-api — M3 用 adaptive/disabled。 */
function normalizeMinimaxModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

export function isGatewayMinimaxModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'minimax';
}

/** M2.x 无法关闭 thinking；M3 支持 disabled。 */
export function isMinimaxM3ThinkingSwitchModel(model: string): boolean {
  const id = normalizeMinimaxModelId(model);
  return id.includes('m3') || id.includes('minimax-m3');
}

/**
 * Gateway MiniMax：经 minimax 命名空间注入 thinking.type。
 * M3 经 Gateway open-responses 当前不产出 reasoning-delta，Thought UI 仍可能为空。
 */
export function buildGatewayMinimaxProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayMinimaxModel(config.llmVendor, config.model)) {
    return {};
  }

  return {
    minimax: {
      thinking: {
        type: config.vendorExtendedThinking === false ? 'disabled' : 'adaptive',
      },
    } as JsonObject,
  };
}
