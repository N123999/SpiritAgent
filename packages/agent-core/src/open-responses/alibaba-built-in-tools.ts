import type { JsonObject, JsonValue } from '../ports.js';
import { isCodeCompletionTransportProfile } from '../code-completion/transport-profile.js';
import type { OpenAiTransportConfig } from '../openai/openai-compat.js';
import {
  isOpenAiCompatibleTransportConfig,
  isOpenResponsesTransportConfig,
  type LlmTransportConfig,
} from '../provider-config.js';

export const ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES = [
  'web_search',
  'code_interpreter',
] as const;

export type AlibabaResponsesBuiltInToolType = (typeof ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES)[number];

export interface AlibabaChatCompletionsExtraBodyOptions {
  /** Agent rounds use streaming; required for code interpreter on Chat API. */
  streaming?: boolean;
}

function alibabaLlmVendor(config: LlmTransportConfig): string | undefined {
  if (isOpenAiCompatibleTransportConfig(config) || isOpenResponsesTransportConfig(config)) {
    return config.llmVendor;
  }

  return undefined;
}

export function shouldUseAlibabaBuiltInTools(config: LlmTransportConfig): boolean {
  if (alibabaLlmVendor(config) !== 'alibaba') {
    return false;
  }

  return isOpenAiCompatibleTransportConfig(config) || isOpenResponsesTransportConfig(config);
}

export function shouldUseAlibabaChatCompletionsBuiltInTools(config: LlmTransportConfig): boolean {
  return isOpenAiCompatibleTransportConfig(config) && alibabaLlmVendor(config) === 'alibaba';
}

export function shouldPatchAlibabaChatCompletionsExtraBody(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'transportRequestProfile'>,
): boolean {
  return config.llmVendor === 'alibaba' && (
    isCodeCompletionTransportProfile(config)
    || shouldUseAlibabaChatCompletionsBuiltInTools(config as LlmTransportConfig)
  );
}

export function buildAlibabaChatCompletionsExtraBodyForConfig(
  config: Pick<OpenAiTransportConfig, 'transportRequestProfile'>,
  options: AlibabaChatCompletionsExtraBodyOptions = {},
): JsonObject {
  if (isCodeCompletionTransportProfile(config)) {
    return { enable_thinking: false };
  }

  return buildAlibabaChatCompletionsExtraBody(options);
}

export function shouldUseAlibabaResponsesBuiltInTools(config: LlmTransportConfig): boolean {
  return isOpenResponsesTransportConfig(config) && alibabaLlmVendor(config) === 'alibaba';
}

export function buildAlibabaChatCompletionsExtraBody(
  options: AlibabaChatCompletionsExtraBodyOptions = {},
): JsonObject {
  const streaming = options.streaming ?? true;
  if (!streaming) {
    return { enable_search: true };
  }

  return {
    enable_search: true,
    enable_thinking: true,
    enable_code_interpreter: true,
    search_options: {
      search_strategy: 'agent_max',
    },
  };
}

export function buildAlibabaResponsesBuiltInTools(): JsonObject[] {
  return ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES.map((type) => ({ type }));
}

export function mergeAlibabaResponsesBuiltInTools(
  existingTools: readonly JsonValue[],
): JsonValue[] {
  const merged = [...existingTools];
  const presentTypes = new Set<string>();

  for (const tool of merged) {
    const type = readResponsesBuiltInToolType(tool);
    if (type) {
      presentTypes.add(type);
    }
  }

  for (const type of ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES) {
    if (!presentTypes.has(type)) {
      merged.push({ type });
      presentTypes.add(type);
    }
  }

  return merged;
}

function readResponsesBuiltInToolType(tool: JsonValue): string | undefined {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
    return undefined;
  }

  const record = tool as JsonObject;
  return typeof record.type === 'string' ? record.type : undefined;
}
