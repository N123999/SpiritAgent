import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
  LlmTransport,
  ToolExecutionOutput,
} from './ports.js';
import type { LlmTransportConfig } from './provider-config.js';
import { isAnthropicTransportConfig } from './provider-config.js';
import type { JsonSchemaTransport } from './json-schema.js';
import type { LlmToolAgentState } from './llm-tool-agent.js';
import { AiSdkOpenAiCompatibleTransport } from './openai/ai-sdk-transport.js';
import { AiSdkAnthropicTransport } from './anthropic/ai-sdk-transport.js';

export interface LlmImageGenerationTransport {
  generateImage(
    config: LlmTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput>;
}

export type SpiritLlmTransport = LlmTransport<
  LlmTransportConfig,
  LlmToolAgentState
> & LlmImageGenerationTransport;

export function createLlmTransport(
  config?: LlmTransportConfig,
): SpiritLlmTransport {
  if (isAnthropicTransportConfig(config)) {
    return new AiSdkAnthropicTransport();
  }

  return new AiSdkOpenAiCompatibleTransport() as unknown as SpiritLlmTransport;
}

export function createJsonSchemaTransport(
  config?: LlmTransportConfig,
): JsonSchemaTransport {
  if (isAnthropicTransportConfig(config)) {
    return new AiSdkAnthropicTransport();
  }

  return new AiSdkOpenAiCompatibleTransport() as unknown as JsonSchemaTransport;
}
