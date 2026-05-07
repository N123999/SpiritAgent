import type { JsonObject, JsonValue } from '../ports.js';
import { cloneJsonValue } from '../tool-agent.js';

/** 与宿主 `ModelProfile.provider` 对齐；用于在 OpenAI 形态 API 上附加厂商扩展字段。 */
export type OpenAiLlmVendor = 'deepseek' | 'kimi' | 'minimax' | 'alibaba' | 'custom';

export interface OpenAiTransportConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  /**
   * 当前模型在配置中的提供方（小写）。缺省时不附加任何厂商专有请求体字段。
   */
  llmVendor?: OpenAiLlmVendor;
  /**
   * 抽象推理强度；`default` 表示不指定，交给上游或模型默认行为。
   * 非 `default` 时直接走 OpenAI chat.completions 官方字段 `reasoning_effort`。
   */
  reasoningEffort?: 'default' | 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * 仅对 `deepseek` / `kimi`：是否在所有经本 transport 的 chat.completions 请求体中加入
   * `thinking: { type: 'enabled' | 'disabled' }`（含主对话、工具轮与历史压缩）。
   * 缺省为 `true`（enabled）；设为 `false` 时发送 `disabled`。
   */
  vendorExtendedThinking?: boolean;
}

export interface OpenAiRequestTrace extends JsonObject {
  kind: 'openai_sdk_chat_completions' | 'deepseek_sdk_chat_completions' | 'alibaba_sdk_chat_completions';
  stepIndex: number;
  model: string;
  stream: boolean;
  /** OpenAI 官方 chat.completions 请求字段。 */
  reasoning_effort?: JsonValue;
  toolChoice?: 'auto';
  messages: JsonValue[];
  tools?: JsonValue[];
  /** 与 SDK 请求体一并发送的真正厂商扩展（若有），例如 DeepSeek/Kimi 的 `thinking`。 */
  vendorExtras?: JsonValue;
}

/**
 * OpenAI 官方 chat.completions 推理强度字段。
 */
export function openAiReasoningEffort(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): string | undefined {
  if (config.reasoningEffort === undefined || config.reasoningEffort === 'default') {
    return undefined;
  }

  if (isDeepSeekV4ReasoningEffortModel(config)) {
    switch (config.reasoningEffort) {
      case 'low':
      case 'medium':
      case 'high':
        return 'high';
      case 'xhigh':
      case 'max':
        return 'max';
      case 'none':
        return undefined;
    }
  }

  if (isKimiReasoningEffortModel(config)) {
    switch (config.reasoningEffort) {
      case 'minimal':
        return 'minimal';
      case 'none':
        return undefined;
      case 'xhigh':
      case 'max':
        return 'high';
      default:
        return config.reasoningEffort;
    }
  }

  if (config.reasoningEffort === 'max') {
    return 'xhigh';
  }

  return config.reasoningEffort;
}

function isDeepSeekV4ReasoningEffortModel(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model'>,
): boolean {
  if (config.llmVendor !== 'deepseek') {
    return false;
  }

  const normalizedModel = config.model.trim().toLowerCase();
  return normalizedModel === 'deepseek-v4-pro' || normalizedModel === 'deepseek-v4-flash';
}

function isKimiReasoningEffortModel(
  config: Pick<OpenAiTransportConfig, 'llmVendor'>,
): boolean {
  return config.llmVendor === 'kimi';
}

/**
 * DeepSeek / Kimi 等网关常在 OpenAI 兼容路径上接受顶层 `thinking` 字段以开关思考链输出。
 * 凡走 OpenAI-compatible transport 的 chat.completions（含压缩）均合并，避免同一连接上部分请求缺字段导致网关行为不一致。
 */
export function openAiVendorChatCompletionBodyExtras(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'vendorExtendedThinking'>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (config.llmVendor === 'deepseek' || config.llmVendor === 'kimi') {
    const enabled = config.vendorExtendedThinking !== false;
    extras.thinking = { type: enabled ? 'enabled' : 'disabled' };
  }

  return extras;
}

export function buildOpenAiRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const reasoningEffort = openAiReasoningEffort(config);
  const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
  const trace: OpenAiRequestTrace = {
    kind: 'openai_sdk_chat_completions',
    stepIndex,
    model: config.model,
    stream,
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? {
          toolChoice: 'auto',
          tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)),
        }
      : {}),
    ...(Object.keys(vendorExtras).length > 0
      ? { vendorExtras: vendorExtras as JsonValue }
      : {}),
  };

  return [trace];
}