import type { ModelReasoningEffortContext } from '../reasoning-effort.js';
import type { OpenResponsesReasoningSummary } from '../open-responses/responses-compat.js';
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

/** MiMo Responses API：Reasoning Effort 主控（与 OpenAI 一致），非 Chat thinking.type。 */
export function isXiaomiResponsesReasoningEffortContext(
  context?: ModelReasoningEffortContext,
): boolean {
  if (context?.transportKind !== 'open-responses') {
    return false;
  }
  const model = context.model ?? '';
  if (context.provider === 'xiaomi') {
    return isXiaomiThinkingSwitchEligibleModel(model);
  }
  if (context.provider === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'xiaomi') {
    return isXiaomiThinkingSwitchEligibleModel(model);
  }
  return false;
}

function buildXiaomiResponsesReasoningOptions(
  model: string,
  reasoningEffort: string | undefined,
  reasoningSummary: OpenResponsesReasoningSummary | undefined,
  providerOptionsKey: 'openai' | 'xiaomi',
): Record<string, JsonObject> {
  if (!isXiaomiThinkingSwitchEligibleModel(model)) {
    return {};
  }

  const reasoningOptions: JsonObject = {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
  };

  if (Object.keys(reasoningOptions).length === 0) {
    return {};
  }

  return { [providerOptionsKey]: reasoningOptions };
}

/** Gateway Xiaomi MiMo Responses：经 openai 命名空间注入 reasoningEffort。 */
export function buildGatewayXiaomiResponsesProviderOptions(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model'>,
  reasoningEffort: string | undefined,
  reasoningSummary?: OpenResponsesReasoningSummary,
): Record<string, JsonObject> {
  if (!isGatewayXiaomiModel(config.llmVendor, config.model)) {
    return {};
  }
  return buildXiaomiResponsesReasoningOptions(config.model, reasoningEffort, reasoningSummary, 'openai');
}

/**
 * 直连 Xiaomi MiMo Responses：经 xiaomi 命名空间注入 reasoningEffort。
 * @ai-sdk/open-responses 的 providerOptionsName 与 createOpenResponses({ name }) 一致，须用 xiaomi 而非 openai。
 */
export function buildDirectXiaomiResponsesProviderOptions(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model'>,
  reasoningEffort: string | undefined,
  reasoningSummary?: OpenResponsesReasoningSummary,
): Record<string, JsonObject> {
  if (config.llmVendor !== 'xiaomi') {
    return {};
  }
  return buildXiaomiResponsesReasoningOptions(config.model, reasoningEffort, reasoningSummary, 'xiaomi');
}

/** Gateway Xiaomi MiMo Chat：经 xiaomi 命名空间注入 thinking.type（非 openai 命名空间）。 */
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
