import type { AnthropicThinkingConfig } from './anthropic/anthropic-compat.js';
import type { ModelReasoningEffortContext } from './reasoning-effort.js';
import {
  isDeepSeekV4ReasoningEffortModel,
  isGoogleReasoningEffortModel,
  isMoonshotReasoningEffortModel,
  isOpenRouterAnthropicClaudeReasoningModel,
  isXaiReasoningEffortModel,
} from './reasoning-effort.js';
import { parseGatewayUpstreamSlug } from './openai/gateway-code-completion-thinking.js';
import { isMinimaxM3ThinkingSwitchModel } from './openai/gateway-minimax-thinking.js';
import { isMoonshotThinkingSwitchModel } from './openai/moonshot-thinking-switch.js';
import { isXiaomiResponsesReasoningEffortContext, isXiaomiThinkingSwitchEligibleModel } from './openai/gateway-xiaomi-thinking.js';
import { isZaiThinkingSwitchEligibleModel } from './openai/gateway-zai-thinking.js';
import {
  isRoutedAnthropicClaudeModel,
  resolveRoutedAnthropicClaudeCapabilities,
  type RoutedAnthropicClaudeCapabilities,
} from './openai/routed-anthropic-claude-capabilities.js';

const DIRECT_THINKING_SWITCH_PROVIDERS = new Set([
  'z-ai',
  'zhipu-ai',
  'xiaomi',
  'volcengine',
  'alibaba',
  'siliconflow',
]);

const GATEWAY_REASONING_EFFORT_SLUGS = new Set([
  'openai',
  'google',
  'anthropic',
  'xai',
]);

export type ModelEffortControlLabelKind = 'effort' | 'reasoningEffort';

function normalizeModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function routedAnthropicModelId(context?: ModelReasoningEffortContext): string | undefined {
  const model = context?.model?.trim();
  if (!model) {
    return undefined;
  }
  if (isRoutedAnthropicClaudeModel(model)) {
    return model;
  }
  const prefixed = `anthropic/${model}`;
  return isRoutedAnthropicClaudeModel(prefixed) ? prefixed : undefined;
}

function resolveAnthropicClaudeCapabilitiesForContext(
  context?: ModelReasoningEffortContext,
): RoutedAnthropicClaudeCapabilities | undefined {
  const modelId = routedAnthropicModelId(context);
  if (modelId === undefined) {
    return undefined;
  }
  return resolveRoutedAnthropicClaudeCapabilities(modelId);
}

/** Claude adaptive thinking（4.6+）：UI Effort 控件与 output_config.effort 语义。 */
export function isAnthropicClaudeEffortModel(context?: ModelReasoningEffortContext): boolean {
  return isAnthropicClaudeAdaptiveThinkingModel(context);
}

/** Claude adaptive thinking（4.6+）：开启时 thinking.type=adaptive。 */
export function isAnthropicClaudeAdaptiveThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);
  return capabilities?.thinkingMode === 'adaptive';
}

/** Claude budget thinking（4.5 及更早支持 extended thinking 的型号）：开启时 thinking.type=enabled。 */
export function isAnthropicClaudeBudgetThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);
  return capabilities?.thinkingMode === 'budget';
}

/** Claude 可开关 thinking（adaptive 或 budget）；thinkingMode=none 的型号不在此列。 */
export function isAnthropicClaudeSwitchableThinkingModel(
  context?: ModelReasoningEffortContext,
): boolean {
  return isAnthropicClaudeAdaptiveThinkingModel(context)
    || isAnthropicClaudeBudgetThinkingModel(context);
}

export function modelEffortControlLabelKind(
  context?: ModelReasoningEffortContext,
): ModelEffortControlLabelKind {
  return isAnthropicClaudeEffortModel(context) ? 'effort' : 'reasoningEffort';
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
  return isDeepSeekV4ReasoningEffortModel(context);
}

function isGatewayThinkingSwitchModel(context?: ModelReasoningEffortContext): boolean {
  if (context?.provider !== 'vercel-ai-gateway') {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? '');
  if (slug === undefined) {
    return false;
  }
  if (GATEWAY_REASONING_EFFORT_SLUGS.has(slug)) {
    return false;
  }
  // DeepSeek V3 及以下靠模型名区分 thinking 变体，无 extended thinking 开关。
  if (slug === 'deepseek') {
    return isDeepSeekV4ReasoningEffortModel(context);
  }
  if (slug === 'moonshotai') {
    return isMoonshotThinkingSwitchModel(context);
  }
  if (slug === 'xiaomi') {
    if (context.transportKind === 'open-responses') {
      return false;
    }
    return isXiaomiThinkingSwitchEligibleModel(context.model ?? '');
  }
  if (slug === 'zai') {
    return isZaiThinkingSwitchEligibleModel(context.model ?? '');
  }
  if (slug === 'minimax') {
    return isMinimaxM3ThinkingSwitchModel(context.model ?? '');
  }
  return true;
}

function isGatewayReasoningEffortPrimaryControlModel(
  context?: ModelReasoningEffortContext,
): boolean {
  if (context?.provider !== 'vercel-ai-gateway') {
    return false;
  }
  const slug = parseGatewayUpstreamSlug(context.model ?? '');
  if (slug === undefined) {
    return false;
  }
  if (slug === 'moonshotai') {
    return !isMoonshotThinkingSwitchModel(context);
  }
  return GATEWAY_REASONING_EFFORT_SLUGS.has(slug);
}

/** OpenAI / Reasoning Effort 主控厂商：不显示 Thinking 开关（不含 DeepSeek V4 hybrid 与 Claude switchable）。 */
export function modelUsesReasoningEffortPrimaryControl(
  context?: ModelReasoningEffortContext,
): boolean {
  if (isAnthropicClaudeSwitchableThinkingModel(context)) {
    return false;
  }
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
  if (isXaiReasoningEffortModel(context)) {
    return true;
  }
  if (isMoonshotReasoningEffortModel(context) && !isMoonshotThinkingSwitchModel(context)) {
    return true;
  }
  if (isGoogleReasoningEffortModel(context)) {
    return true;
  }
  if (isGatewayReasoningEffortPrimaryControlModel(context)) {
    return true;
  }
  if (isOpenRouterAnthropicClaudeReasoningModel(context)) {
    return true;
  }
  if (isXiaomiResponsesReasoningEffortContext(context)) {
    return true;
  }

  return false;
}

export function modelSupportsThinkingSwitch(context?: ModelReasoningEffortContext): boolean {
  if (isAnthropicClaudeSwitchableThinkingModel(context)) {
    return true;
  }
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  if (isDeepSeekReasoningOnlyModel(context)) {
    return false;
  }

  const provider = context?.provider;
  if (provider === 'minimax') {
    return isMinimaxM3ThinkingSwitchModel(context?.model ?? '');
  }
  if (provider !== undefined && DIRECT_THINKING_SWITCH_PROVIDERS.has(provider)) {
    if (provider === 'xiaomi' && context?.transportKind === 'open-responses') {
      return false;
    }
    return true;
  }
  if (isDeepSeekThinkingSwitchModel(context)) {
    return true;
  }
  if (isMoonshotThinkingSwitchModel(context)) {
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
 * Inspector：是否展示 Effort / Reasoning Effort 控件。
 * Claude adaptive（4.6+）始终展示 Effort；budget 型 Claude 仅 Thinking 开关；
 * Reasoning Effort 主控模型始终展示；其余 thinking 型模型仅在 thinking 开启时展示。
 */
export function modelShowsReasoningEffortControl(
  context?: ModelReasoningEffortContext,
  thinkingEnabled?: boolean,
): boolean {
  if (isAnthropicClaudeAdaptiveThinkingModel(context)) {
    return true;
  }
  if (isAnthropicClaudeBudgetThinkingModel(context)) {
    return false;
  }
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

/** thinking 关闭时剥离 reasoning effort；Claude adaptive Effort 与 Reasoning Effort 主控模型保留用户档位。 */
export function shouldPinReasoningEffortToDefault(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): boolean {
  if (isAnthropicClaudeAdaptiveThinkingModel(context)) {
    return false;
  }
  if (modelUsesReasoningEffortPrimaryControl(context)) {
    return false;
  }
  return thinkingEnabled === false;
}

export function resolveModelThinkingEnabled(thinkingEnabled?: boolean): boolean {
  return thinkingEnabled !== false;
}

/** Anthropic 直连 transport：显式 thinking 配置（adaptive / enabled / disabled）。 */
export function resolveAnthropicExplicitThinkingConfig(
  thinkingEnabled: boolean | undefined,
  context?: ModelReasoningEffortContext,
): AnthropicThinkingConfig | undefined {
  const capabilities = resolveAnthropicClaudeCapabilitiesForContext(context);

  if (capabilities?.thinkingMode === 'adaptive') {
    if (thinkingEnabled === false) {
      return { type: 'disabled' };
    }
    return {
      type: 'adaptive',
      ...(capabilities.adaptiveDisplay ? { display: capabilities.adaptiveDisplay } : {}),
    };
  }

  if (capabilities?.thinkingMode === 'budget') {
    if (thinkingEnabled === false) {
      return { type: 'disabled' };
    }
    return undefined;
  }

  if (thinkingEnabled === false && modelSupportsThinkingSwitch(context)) {
    return { type: 'disabled' };
  }

  return undefined;
}
