import type { JsonObject, JsonValue } from '../ports.js';
import type { LlmModelCapabilities } from '../llm-provider-shared.js';
import { resolveOpenAiTransportReasoningEffortForContext } from '../reasoning-effort.js';
import { cloneJsonValue } from '../tool-agent.js';

/** 与宿主 `ModelProfile.provider` 对齐；用于在 OpenAI 形态 API 上附加厂商扩展字段。 */
export type OpenAiLlmVendor =
  | 'deepseek'
  | 'xai'
  | 'moonshot-ai'
  | 'z-ai'
  | 'minimax'
  | 'xiaomi'
  | 'alibaba'
  | 'vercel-ai-gateway'
  | 'openrouter'
  | 'openai'
  | 'google'
  | 'google-vertex-ai'
  | 'volcengine'
  | 'azure'
  | 'custom';

export type OpenAiModelCapabilities = LlmModelCapabilities;

export interface OpenAiModelCompatibilityProfile {
  /**
   * 仅当这里为 `true` 时，compat 层才会主动按 capabilities 裁剪请求。
   *
   * 这里不能只依赖 AI SDK 的 warning：
   * 1. warning 发生在请求已经构造并发出之后，拦截时机太晚；
   * 2. provider 返回的 `file` 能力告警过于宽泛，无法稳定映射到自己的 image/audio/video 输入语义；
   * 3. 一旦不受支持的内容留在历史里，后续每轮请求都会重复触发同类告警。
   *
   * 所以对已知兼容性敏感的 provider/model，维护显式 capabilities 表，
   * 在序列化前就做前置裁剪；未知模型则保持现状，不做武断降级。
   */
  hasExplicitCapabilities: boolean;
  capabilities: OpenAiModelCapabilities;
}

export interface OpenAiImageGenerationConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: OpenAiModelCapabilities;
}

export interface OpenAiVideoGenerationConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: OpenAiModelCapabilities;
}

export interface OpenAiTransportConfig {
  transportKind?: 'openai-compatible';
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
   * User-configured explicit model capabilities. When provided, these override
   * provider/model inference for compatibility decisions such as image input.
   */
  modelCapabilities?: OpenAiModelCapabilities;
  /**
   * Optional dedicated model role used by the `generate_image` tool.
   */
  imageGeneration?: OpenAiImageGenerationConfig;
  /**
   * Optional dedicated model role used by the `generate_video` tool.
   */
  videoGeneration?: OpenAiVideoGenerationConfig;
  /**
   * 抽象推理强度；`default` 表示不指定，交给上游或模型默认行为。
   * 非 `default` 时直接走 OpenAI chat.completions 官方字段 `reasoning_effort`。
   */
  reasoningEffort?: 'default' | 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /**
   * 仅对 `deepseek` / `moonshot-ai`：是否在所有经本 transport 的 chat.completions 请求体中加入
   * `thinking: { type: 'enabled' | 'disabled' }`（含主对话、工具轮与历史压缩）。
   * 缺省为 `true`（enabled）；设为 `false` 时发送 `disabled`。
   */
  vendorExtendedThinking?: boolean;
  /** Google Vertex AI 项目 ID（Express 模式可省略）。 */
  vertexProject?: string;
  /** Google Vertex AI 区域，如 `us-central1`（Express 模式可省略）。 */
  vertexLocation?: string;
  /** 服务账号 `client_email`（与 `vertexPrivateKey` 成对）。 */
  vertexClientEmail?: string;
  /** 服务账号 `private_key`（与 `vertexClientEmail` 成对）。 */
  vertexPrivateKey?: string;
  /**
   * 透传 `createVertex` 的 `googleAuthOptions`（如 ADC 自定义或测试用 `authClient`）。
   * 若已设置 `vertexClientEmail` / `vertexPrivateKey`，宿主构建的 credentials 优先于此字段。
   */
  vertexGoogleAuthOptions?: Record<string, unknown>;
}

export interface OpenAiRequestTrace extends JsonObject {
  kind:
    | 'openai_sdk_chat_completions'
    | 'deepseek_sdk_chat_completions'
    | 'xai_sdk_chat_completions'
    | 'moonshot_sdk_chat_completions'
    | 'alibaba_sdk_chat_completions'
    | 'gateway_sdk_chat_completions'
    | 'openai_official_sdk_chat_completions';
  stepIndex: number;
  model: string;
  stream: boolean;
  /** OpenAI 官方 chat.completions 请求字段。 */
  reasoning_effort?: JsonValue;
  toolChoice?: 'auto';
  messages: JsonValue[];
  tools?: JsonValue[];
  /** 与 SDK 请求体一并发送的真正厂商扩展（若有），例如 DeepSeek/Moonshot 的 `thinking`。 */
  vendorExtras?: JsonValue;
}

export function resolveOpenAiModelCompatibilityProfile(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'modelCapabilities'>,
): OpenAiModelCompatibilityProfile {
  if (config.modelCapabilities !== undefined) {
    return {
      hasExplicitCapabilities: true,
      capabilities: { ...config.modelCapabilities },
    };
  }

  if (config.llmVendor === 'deepseek') {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === 'moonshot-ai') {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  if (config.llmVendor === 'xiaomi') {
    return {
      hasExplicitCapabilities: true,
      capabilities: {},
    };
  }

  return {
    hasExplicitCapabilities: false,
    capabilities: {},
  };
}

/**
 * OpenAI 官方 chat.completions 推理强度字段。
 */
export function openAiReasoningEffort(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): string | undefined {
  return resolveOpenAiTransportReasoningEffortForContext(config.reasoningEffort, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
    transportKind: 'openai-compatible',
  });
}

/**
 * DeepSeek 等仍走 OpenAI-compatible 兜底的网关可在请求体顶层接受 `thinking` 字段。
 * Moonshot 已改用 `@ai-sdk/moonshotai` 的 `providerOptions.moonshotai.thinking`。
 */
export function openAiVendorChatCompletionBodyExtras(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'vendorExtendedThinking'>,
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (config.llmVendor === 'deepseek') {
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
