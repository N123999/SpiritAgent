export type LlmTransportKind = 'openai-compatible' | 'open-responses' | 'anthropic' | 'bedrock';

/** 区分主 Agent 对话与代码补全等非 Agent 轻量 LLM 请求的策略画像。 */
export type TransportRequestProfile = 'agent' | 'code-completion';

export interface LlmModelCapabilities {
  chat?: true;
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
  imageGeneration?: true;
}
