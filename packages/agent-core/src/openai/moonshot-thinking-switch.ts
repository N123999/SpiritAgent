import type { JsonObject } from '../ports.js';
import type { ModelReasoningEffortContext } from '../reasoning-effort.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { openAiReasoningEffort } from './openai-compat.js';
import { parseGatewayUpstreamSlug } from './gateway-code-completion-thinking.js';

/** 文档：https://platform.kimi.com/docs/api/chat — 仅 kimi-k2.5+ 支持 thinking.type 开关。 */
function normalizeMoonshotModelId(model: string): string {
  const normalized = model.trim().toLowerCase();
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function parseKimiKModelVersion(model: string): { major: number; minor: number } | undefined {
  const match = normalizeMoonshotModelId(model).match(/^kimi-k(\d+)(?:\.(\d+))?/);
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

/** moonshot-v1-* 与 kimi-k2.7-code-*（含 highspeed）不支持 thinking.type 开关。 */
export function isMoonshotThinkingSwitchExcludedModel(model: string): boolean {
  const id = normalizeMoonshotModelId(model);
  if (id.startsWith('moonshot-v1-') || id === 'moonshot-v1') {
    return true;
  }
  if (/^kimi-k2\.7-code(?:-|$)/.test(id)) {
    return true;
  }
  return false;
}

/** kimi-k2.5 及以上（含未来 k2.x / k3+），排除不支持 thinking 的型号。 */
export function isMoonshotThinkingSwitchEligibleModel(model: string): boolean {
  if (isMoonshotThinkingSwitchExcludedModel(model)) {
    return false;
  }
  const version = parseKimiKModelVersion(model);
  if (version === undefined) {
    return false;
  }
  if (version.major > 2) {
    return true;
  }
  return version.major === 2 && version.minor >= 5;
}

export function isMoonshotThinkingSwitchModel(
  context?: ModelReasoningEffortContext,
): boolean {
  if (context?.provider === 'moonshot-ai') {
    return isMoonshotThinkingSwitchEligibleModel(context.model ?? '');
  }
  if (
    context?.provider === 'vercel-ai-gateway'
    && parseGatewayUpstreamSlug(context.model ?? '') === 'moonshotai'
  ) {
    return isMoonshotThinkingSwitchEligibleModel(context.model ?? '');
  }
  return false;
}

export function isGatewayMoonshotModel(
  llmVendor: string | undefined,
  model: string,
): boolean {
  return llmVendor === 'vercel-ai-gateway' && parseGatewayUpstreamSlug(model) === 'moonshotai';
}

/** Gateway Moonshot：开关型型号经 moonshotai 命名空间控制 thinking；reasoning_effort 仍走 openai 命名空间。 */
export function buildGatewayMoonshotProviderOptions(
  config: Pick<
    OpenAiTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'vendorExtendedThinking'
  >,
): Record<string, JsonObject> {
  if (!isGatewayMoonshotModel(config.llmVendor, config.model)) {
    return {};
  }

  const context: ModelReasoningEffortContext = {
    provider: 'vercel-ai-gateway',
    model: config.model,
    transportKind: 'openai-compatible',
  };
  if (!isMoonshotThinkingSwitchModel(context)) {
    return {};
  }

  if (config.vendorExtendedThinking === false) {
    return {
      moonshotai: {
        thinking: { type: 'disabled' },
      } as JsonObject,
    };
  }

  const result: Record<string, JsonObject> = {
    moonshotai: {
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
