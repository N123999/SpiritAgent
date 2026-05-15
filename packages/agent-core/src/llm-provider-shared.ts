export type LlmTransportKind = 'openai-compatible' | 'anthropic';

export interface LlmModelCapabilities {
  chat?: true;
  vision?: true;
  audioInput?: true;
  videoInput?: true;
  imageGeneration?: true;
}
