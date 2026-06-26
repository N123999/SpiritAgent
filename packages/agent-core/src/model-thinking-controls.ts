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

function isGatewayReasoningEffortPrimaryControlModel(
  context?: ModelReasoningEffortContext,
): boolean {
  if (context?.provider !== 'vercel-ai-gateway') {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? '');
  return slug !== undefined && GATEWAY_REASONING_EFFORT_SLUGS.has(slug);
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
  if (isGatewayReasoningEffortPrimaryControlModel(context)) {
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

/** DeepSeek V4：仅 thinking 开启时 API 接受 reasoning_effort（high/max）。 */
export function modelSupportsReasoningEffortWhileThinking(
  context?: ModelReasoningEffortContext,
): boolean {
  return isDeepSeekV4ReasoningEffortModel(context);
}

/**
 * Inspector：是否允许展示 Reasoning Effort 控件。
 * Reasoning Effort 主控模型始终展示；thinking 型模型仅在 thinking 开启时展示（具体档位由 modelReasoningEffortOptions 决定）。
 */
export function modelShowsReasoningEffortControl(
  context?: ModelReasoningEffortContext,
  thinkingEnabled?: boolean,
): boolean {
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return true;
  }
  if (!modelSupportsThinkingSwitch(context)) {
    return false;
  }
  return thinkingEnabled !== false;
}

export function resolveVendorExtendedThinking(thinkingEnabled?: boolean): boolean | undefined {
  if (thinkingEnabled === false) {
    return false;
  }
  return undefined;
}

/** thinking 关闭时剥离 reasoning effort；开启时保留用户所选档位（含 Z.ai / DeepSeek V4）。 */
export function shouldPinReasoningEffortToDefault(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): boolean {
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  return thinkingEnabled === false;
}

export function resolveModelThinkingEnabled(thinkingEnabled?: boolean): boolean {
  return thinkingEnabled !== false;
}
