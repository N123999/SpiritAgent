import type { JsonObject, JsonValue } from '../ports.js';
import { cloneJsonValue } from '../tool-agent.js';
import type { LlmModelCapabilities } from '../llm-provider-shared.js';

/** Bedrock 推理强度；`default` 表示不注入 `reasoningConfig`。 */
export type BedrockReasoningEffort =
  | 'default'
  | 'minimal'
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface BedrockTransportConfig {
  transportKind: 'bedrock';
  model: string;
  /** AWS 区域（如 `us-east-1`）；来自宿主 `awsRegion`。 */
  region: string;
  /** Bearer API Key；与 IAM 凭证二选一或 API Key 优先。 */
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** 临时凭证；首版 UI 可不暴露，类型预留。 */
  sessionToken?: string;
  /** 自定义 Bedrock endpoint / proxy。 */
  baseUrl?: string;
  compactModel?: string;
  workspaceRoot?: string;
  modelCapabilities?: LlmModelCapabilities;
  reasoningEffort?: BedrockReasoningEffort;
  supportedReasoningEfforts?: readonly BedrockReasoningEffort[];
}

export interface BedrockRequestTrace extends JsonObject {
  kind: 'bedrock_sdk_converse';
  stepIndex: number;
  model: string;
  stream: boolean;
  region: string;
  messages: JsonValue[];
  tools?: JsonValue[];
  providerOptions?: JsonValue;
}

export function bedrockApiBaseFromRegion(region: string): string {
  const normalized = region.trim().toLowerCase();
  if (!normalized) {
    return 'https://bedrock.us-east-1.amazonaws.com';
  }
  return `https://bedrock.${normalized}.amazonaws.com`;
}

export function isAmazonNovaBedrockModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes('amazon.nova') || normalized.includes('us.amazon.nova');
}

export function isAnthropicClaudeBedrockModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes('anthropic.claude') || normalized.includes('.anthropic.claude');
}

export function bedrockReasoningConfigFromEffort(
  model: string,
  effort: BedrockReasoningEffort | undefined,
): JsonObject | undefined {
  if (effort === undefined || effort === 'default' || effort === 'none' || effort === 'minimal') {
    return undefined;
  }

  if (isAmazonNovaBedrockModel(model)) {
    const maxReasoningEffort =
      effort === 'low'
        ? 'low'
        : effort === 'high' || effort === 'xhigh' || effort === 'max'
          ? 'high'
          : 'medium';
    return {
      type: 'enabled',
      maxReasoningEffort,
    };
  }

  const budgetTokens =
    effort === 'low'
      ? 1_024
      : effort === 'medium'
        ? 4_096
        : effort === 'high'
          ? 12_000
          : effort === 'xhigh' || effort === 'max'
            ? 32_000
            : 8_192;

  return {
    type: 'enabled',
    budgetTokens,
  };
}

export function buildBedrockProviderOptions(
  config: Pick<BedrockTransportConfig, 'model' | 'reasoningEffort'>,
): Record<string, JsonObject> {
  const reasoningConfig = bedrockReasoningConfigFromEffort(config.model, config.reasoningEffort);
  if (reasoningConfig === undefined) {
    return {};
  }

  return {
    bedrock: {
      reasoningConfig,
    },
  };
}

export function buildBedrockRequestTrace(
  config: BedrockTransportConfig,
  stepIndex: number,
  messages: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
): JsonValue[] {
  const providerOptions = buildBedrockProviderOptions(config);
  const trace: BedrockRequestTrace = {
    kind: 'bedrock_sdk_converse',
    stepIndex,
    model: config.model,
    stream,
    region: config.region,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) }
      : {}),
    ...(Object.keys(providerOptions.bedrock ?? {}).length > 0
      ? { providerOptions: providerOptions as JsonValue }
      : {}),
  };

  return [trace];
}
