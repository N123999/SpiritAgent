import type { JsonObject } from '../ports.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { openAiReasoningEffort } from './openai-compat.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

/** 文档：https://docs.z.ai/guides/capabilities/thinking — GLM-4.5+ 支持 thinking.type。 */
function normalizeZaiModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function parseGlmModelVersion(model: string): { major: number; minor: number } | undefined {
  const match = normalizeZaiModelId(model).match(/^glm-(\d+)(?:\.(\d+))?/);
  if (!match) {
    return undefined;
  }
  const majorText = match[1];
  if (majorText === undefined) {
    return undefined;
  }
  const major = Number.parseInt(majorText, 10);
  const minor = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return undefined;
  }
  return { major, minor };
}

/** GLM-4.5 及以上（含未来 glm-5+）支持 thinking.type 开关。 */
export function isZaiThinkingSwitchEligibleModel(model: string): boolean {
  const version = parseGlmModelVersion(model);
  if (version === undefined) {
    return false;
  }
  if (version.major > 4) {
    return true;
  }
  return version.major === 4 && version.minor >= 5;
}

export function isGatewayZaiModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'zai';
}

/** Gateway Z.ai：经 zai 命名空间注入 thinking.type；reasoning_effort 仍走 openai 命名空间。 */
export function buildGatewayZaiProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayZaiModel(config.llmVendor, config.model)) {
    return {};
  }
  if (!isZaiThinkingSwitchEligibleModel(config.model)) {
    return {};
  }

  if (config.vendorExtendedThinking === false) {
    return {
      zai: {
        thinking: { type: 'disabled' },
      } as JsonObject,
    };
  }

  const result: Record<string, JsonObject> = {
    zai: {
      thinking: { type: 'enabled' },
    } as JsonObject,
  };
  const effort = openAiReasoningEffort(config);
  if (effort !== undefined && effort !== 'default' && effort !== 'none') {
    result.openai = {
      reasoningEffort: effort,
    } as JsonObject;
  }
  return result;
}
