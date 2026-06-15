export type LlmTransportKind = 'openai-compatible' | 'open-responses' | 'anthropic' | 'bedrock';

export interface LlmModelCapabilities {
  chat?: true;
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
  imageGeneration?: true;
}
