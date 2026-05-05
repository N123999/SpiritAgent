import type { LlmTransport } from '../ports.js';

import { AiSdkOpenAiCompatibleTransport } from './ai-sdk-transport.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import type { OpenAiJsonSchemaTransport } from './json-schema.js';
import type { OpenAiToolAgentState } from './tool-agent-helpers.js';

export type OpenAiCompatibleTransport = LlmTransport<
  OpenAiTransportConfig,
  OpenAiToolAgentState
>;

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