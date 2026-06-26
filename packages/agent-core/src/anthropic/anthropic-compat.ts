import { isCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import type { JsonObject, JsonValue } from '../ports.js';
import { cloneJsonValue } from '../tool-agent.js';
import type { LlmModelCapabilities, TransportRequestProfile } from '../llm-provider-shared.js';

export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export type AnthropicThinkingConfig =
  | { type: 'adaptive'; display?: 'omitted' | 'summarized' }
  | { type: 'enabled'; budgetTokens: number; display?: 'omitted' | 'summarized' }
  | { type: 'disabled' };

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AnthropicStructuredOutputMode = 'outputFormat' | 'jsonTool' | 'auto';

export interface AnthropicTransportConfig {
  transportKind: 'anthropic';
  apiKey: string;
  model: string;
  baseUrl?: string;
  compactModel?: string;
  workspaceRoot?: string;
  modelCapabilities?: LlmModelCapabilities;
  thinking?: AnthropicThinkingConfig;
  effort?: AnthropicEffort;
  supportedEfforts?: readonly AnthropicEffort[];
  sendReasoning?: boolean;
  disableParallelToolUse?: boolean;
  structuredOutputMode?: AnthropicStructuredOutputMode;
  /** 代码补全等非 Agent 轻量请求的策略画像；缺省为 agent 路径默认行为。 */
  transportRequestProfile?: TransportRequestProfile;
}

export interface AnthropicRequestTrace extends JsonObject {
  kind: 'anthropic_sdk_messages';
  stepIndex: number;
  model: string;
  stream: boolean;
  messages: JsonValue[];
  tools?: JsonValue[];
  providerOptions?: JsonValue;
}

export function resolveAnthropicThinkingConfig(
  config: Pick<
    AnthropicTransportConfig,
    'model' | 'thinking' | 'effort' | 'supportedEfforts' | 'transportRequestProfile'
  >,
): AnthropicThinkingConfig | undefined {
  if (config.thinking !== undefined) {
    return config.thinking;
  }

  if (isCodeCompletionTransportProfile(config)) {
    return { type: 'disabled' };
  }

  if (Array.isArray(config.supportedEfforts) && config.supportedEfforts.length === 0) {
    return { type: 'disabled' };
  }

  const normalizedModel = config.model.trim().toLowerCase();
  if (normalizedModel.includes('claude-opus-4-7')) {
    return { type: 'adaptive', display: 'summarized' };
  }

  if (
    normalizedModel.includes('claude-opus-4-6') ||
    normalizedModel.includes('claude-sonnet-4-6') ||
    normalizedModel.includes('claude-haiku-4-5')
  ) {
    return { type: 'adaptive' };
  }

  if (config.effort !== undefined || (Array.isArray(config.supportedEfforts) && config.supportedEfforts.length > 0)) {
    return { type: 'enabled', budgetTokens: 12_000 };
  }

  return undefined;
}

export function buildAnthropicProviderOptions(
  config: Pick<
    AnthropicTransportConfig,
    | 'model'
    | 'thinking'
    | 'effort'
    | 'supportedEfforts'
    | 'sendReasoning'
    | 'disableParallelToolUse'
    | 'structuredOutputMode'
    | 'transportRequestProfile'
  >,
): Record<string, JsonObject> {
  const thinking = resolveAnthropicThinkingConfig(config);
  const options: JsonObject = {
    toolStreaming: true,
    ...(thinking !== undefined ? { thinking: thinking as unknown as JsonValue } : {}),
  };

  if (config.effort !== undefined) {
    options.effort = config.effort;
  }

  if (config.sendReasoning === false) {
    options.sendReasoning = false;
  }

  if (config.disableParallelToolUse === true) {
    options.disableParallelToolUse = true;
  }

  if (config.structuredOutputMode !== undefined) {
    options.structuredOutputMode = config.structuredOutputMode;
  }

  return {
    anthropic: options,
  };
}

export function buildAnthropicRequestTrace(
  config: AnthropicTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const providerOptions = buildAnthropicProviderOptions(config);
  const trace: AnthropicRequestTrace = {
    kind: 'anthropic_sdk_messages',
    stepIndex,
    model: config.model,
    stream,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) }
      : {}),
    ...(Object.keys(providerOptions.anthropic ?? {}).length > 0
      ? { providerOptions: providerOptions as JsonValue }
      : {}),
  };

  return [trace];
}
