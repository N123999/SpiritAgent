import type { ModelReasoningEffortContext } from './reasoning-effort.js';
import {
  isDeepSeekV4ReasoningEffortModel,
  isGatewayAnthropicClaudeReasoningModel,
  isGoogleReasoningEffortModel,
  isMoonshotReasoningEffortModel,
  isOpenRouterAnthropicClaudeReasoningModel,
  isXaiReasoningEffortModel,
} from './reasoning-effort.js';
import { parseGatewayUpstreamSlug } from './openai/gateway-code-completion-thinking.js';

const DIRECT_THINKING_SWITCH_PROVIDERS = new Set([
  'z-ai',
  'zhipu-ai',
  'minimax',
  'xiaomi',
  'volcengine',
  'alibaba',
  'siliconflow',
]);

const GATEWAY_REASONING_EFFORT_SLUGS = new Set([
  'openai',
  'google',
  'anthropic',
  'moonshotai',
  'xai',
]);

function normalizeModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** DeepSeek R1 / reasoner：始终思考，无 thinking toggle。 */
export function isDeepSeekReasoningOnlyModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== 'deepseek') {
    return false;
  }
  const model = normalizeModelId(context.model);
  return model.includes('deepseek-reasoner')
    || model.includes('deepseek-r1')
    || model === 'deepseek-r1';
}

function isDeepSeekThinkingSwitchModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== 'deepseek') {
    return false;
  }
  if (isDeepSeekReasoningOnlyModel(context)) {
    return false;
  }
  return true;
}

function isGatewayThinkingSwitchModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== 'vercel-ai-gateway') {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? '');
  if (slug === undefined) {
    return false;
  }
  return !GATEWAY_REASONING_EFFORT_SLUGS.has(slug);
}

/** OpenAI / Reasoning Effort 主控厂商：不显示 Thinking 开关（不含 DeepSeek V4 hybrid）。 */
export function modelUsesReasoningEffortPrimaryControl(
  context?: ModelReasoningEffortContext,
): boolean {
  if (isDeepSeekV4ReasoningEffortModel(context)) {
    return false;
  }

  const provider = context?.provider;
  if (provider === 'openai' || provider === 'azure' || provider === 'amazon-bedrock') {
    return true;
  }
  if (provider === 'anthropic') {
    return true;
  }
  if (isXaiReasoningEffortModel(context) || isMoonshotReasoningEffortModel(context)) {
    return true;
  }
  if (isGoogleReasoningEffortModel(context)) {
    return true;
  }
  if (isGatewayAnthropicClaudeReasoningModel(context) || isOpenRouterAnthropicClaudeReasoningModel(context)) {
    return true;
  }

  return false;
}

export function modelSupportsThinkingSwitch(context?: ModelReasoningEffortContext): boolean {
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  if (isDeepSeekReasoningOnlyModel(context)) {
    return false;
  }

  const provider = context?.provider;
  if (provider !== undefined && DIRECT_THINKING_SWITCH_PROVIDERS.has(provider)) {
    return true;
  }
  if (isDeepSeekThinkingSwitchModel(context)) {
    return true;
  }
  if (isGatewayThinkingSwitchModel(context)) {
    return true;
  }

  return false;
}

/** DeepSeek V4 等 hybrid：thinking 开启时 Reasoning Effort 仍可调。 */
export function modelSupportsReasoningEffortWhileThinking(
  context?: ModelReasoningEffortContext,
): boolean {
  return isDeepSeekV4ReasoningEffortModel(context);
}

export function resolveVendorExtendedThinking(thinkingEnabled?: boolean): boolean | undefined {
  if (thinkingEnabled === false) {
    return false;
  }
  return undefined;
}

export function shouldPinReasoningEffortToDefault(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): boolean {
  if (thinkingEnabled === false) {
    return true;
  }
  if (thinkingEnabled === undefined || thinkingEnabled === true) {
    if (modelSupportsReasoningEffortWhileThinking(context)) {
      return false;
    }
    if (modelSupportsThinkingSwitch(context)) {
      return true;
    }
  }
  return false;
}

export function resolveModelThinkingEnabled(thinkingEnabled?: boolean): boolean {
  return thinkingEnabled !== false;
}
