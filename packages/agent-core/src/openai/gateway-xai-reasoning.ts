import type { JsonObject } from '../ports.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

export type XaiProviderReasoningEffort = 'none' | 'low' | 'medium' | 'high';

/** xAI Grok：经 xai 命名空间传 reasoningEffort（含 none 关闭思考）；见 https://docs.x.ai/developers/model-capabilities/text/reasoning */
export function resolveXaiProviderReasoningEffort(
  effort: string | undefined,
): XaiProviderReasoningEffort | undefined {
  if (effort === 'none' || effort === 'low' || effort === 'medium' || effort === 'high') {
    return effort;
  }
  return undefined;
}

export function isGatewayXaiModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'xai';
}

export function buildGatewayXaiProviderOptions(
  llmVendor: string | undefined,
  model: string,
  reasoningEffort?: string,
): Record<string, JsonObject> {
  if (!isGatewayXaiModel(llmVendor, model)) {
    return {};
  }

  const resolvedReasoningEffort = resolveXaiProviderReasoningEffort(reasoningEffort);
  if (resolvedReasoningEffort === undefined) {
    return {};
  }

  return {
    xai: {
      reasoningEffort: resolvedReasoningEffort,
    } as JsonObject,
  };
}
