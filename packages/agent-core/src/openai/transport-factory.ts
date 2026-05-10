import type {
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  ImageGenerationRequest,
  LlmTransport,
  ToolExecutionOutput,
} from '../ports.js';

import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import type { OpenAiJsonSchemaTransport } from './json-schema.js';
import type { OpenAiToolAgentState } from './tool-agent-helpers.js';

export interface OpenAiImageGenerationTransport {
  generateImage(
    config: OpenAiTransportConfig,
    request: ImageGenerationRequest,
    saveGeneratedImage: (request: GeneratedImageSaveRequest) => Promise<GeneratedImageFile>,
  ): Promise<ToolExecutionOutput>;
}

export type OpenAiCompatibleTransport = LlmTransport<
  OpenAiTransportConfig,
  OpenAiToolAgentState
> & OpenAiImageGenerationTransport;

export function createOpenAiCompatibleTransport(
  _config?: unknown,
): OpenAiCompatibleTransport {
  return new AiSdkOpenAiCompatibleTransport();
}

export function createOpenAiJsonSchemaTransport(
  _config?: unknown,
): OpenAiJsonSchemaTransport {
  return new AiSdkOpenAiCompatibleTransport();
}