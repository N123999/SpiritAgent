import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ImageGenerationRequest,
  LlmTransport,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from './ports.js';
import type { LlmTransportConfig } from './provider-config.js';
import { isAnthropicTransportConfig, isOpenResponsesTransportConfig } from './provider-config.js';
import type { JsonSchemaTransport } from './json-schema.js';
import type { LlmToolAgentState } from './llm-tool-agent.js';
import { AiSdkOpenAiCompatibleTransport } from './openai/ai-sdk-transport.js';
import { AiSdkAnthropicTransport } from './anthropic/ai-sdk-transport.js';
import { AiSdkOpenResponsesTransport } from './open-responses/ai-sdk-transport.js';

export interface LlmImageGenerationTransport {
  generateImage(
    config: LlmTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput>;
}

export interface LlmVideoGenerationTransport {
  generateVideo(
    config: LlmTransportConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput>;
}

export type SpiritLlmTransport = LlmTransport<
  LlmTransportConfig,
  LlmToolAgentState
> & LlmImageGenerationTransport & LlmVideoGenerationTransport;

export function createLlmTransport(
  config?: LlmTransportConfig,
): SpiritLlmTransport {
  if (isAnthropicTransportConfig(config)) {
    return new AiSdkAnthropicTransport();
  }

  if (isOpenResponsesTransportConfig(config)) {
    return new AiSdkOpenResponsesTransport() as unknown as SpiritLlmTransport;
  }

  return new AiSdkOpenAiCompatibleTransport() as unknown as SpiritLlmTransport;
}

export function createJsonSchemaTransport(
  config?: LlmTransportConfig,
): JsonSchemaTransport {
  if (isAnthropicTransportConfig(config)) {
    return new AiSdkAnthropicTransport();
  }

  if (isOpenResponsesTransportConfig(config)) {
    return new AiSdkOpenResponsesTransport() as unknown as JsonSchemaTransport;
  }

  return new AiSdkOpenAiCompatibleTransport() as unknown as JsonSchemaTransport;
}
