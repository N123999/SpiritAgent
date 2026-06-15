import type { JsonObject } from '../ports.js';
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
  messages: JsonObject[];
  tools?: JsonObject[];
  providerOptions?: JsonObject;
}
