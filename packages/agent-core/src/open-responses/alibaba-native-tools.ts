import type { JsonObject, JsonValue } from '../ports.js';
import {
  isOpenAiCompatibleTransportConfig,
  isOpenResponsesTransportConfig,
  type LlmTransportConfig,
} from '../provider-config.js';

export const ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES = [
  'web_search',
  'web_extractor',
  'code_interpreter',
] as const;

export type AlibabaResponsesBuiltinToolType = (typeof ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES)[number];

export interface AlibabaChatCompletionsExtraBodyOptions {
  /** Agent rounds use streaming; required for code interpreter and web extractor on Chat API. */
  streaming?: boolean;
}

function alibabaLlmVendor(config: LlmTransportConfig): string | undefined {
  if (isOpenAiCompatibleTransportConfig(config) || isOpenResponsesTransportConfig(config)) {
    return config.llmVendor;
  }

  return undefined;
}

export function shouldUseAlibabaNativeTools(config: LlmTransportConfig): boolean {
  if (alibabaLlmVendor(config) !== 'alibaba') {
    return false;
  }

  return isOpenAiCompatibleTransportConfig(config) || isOpenResponsesTransportConfig(config);
}

export function shouldUseAlibabaChatCompletionsNativeTools(
  config: LlmTransportConfig,
  options: AlibabaChatCompletionsExtraBodyOptions = {},
): boolean {
  if (!isOpenAiCompatibleTransportConfig(config) || alibabaLlmVendor(config) !== 'alibaba') {
    return false;
  }

  const streaming = options.streaming ?? true;
  return streaming;
}

export function shouldUseAlibabaResponsesNativeTools(config: LlmTransportConfig): boolean {
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

export function buildAlibabaResponsesBuiltinTools(): JsonObject[] {
  return ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES.map((type) => ({ type }));
}

export function mergeAlibabaResponsesBuiltinTools(
  existingTools: readonly JsonValue[],
): JsonValue[] {
  const merged = [...existingTools];
  const presentTypes = new Set<string>();

  for (const tool of merged) {
    const type = readResponsesBuiltinToolType(tool);
    if (type) {
      presentTypes.add(type);
    }
  }

  for (const type of ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES) {
    if (!presentTypes.has(type)) {
      merged.push({ type });
      presentTypes.add(type);
    }
  }

  return merged;
}

export function buildAlibabaNativeToolsPromptSection(): string {
  return [
    'Provider-native capabilities on Alibaba (Bailian):',
    'On Chat Completions, web search, web extraction, and code interpreter run via API-side flags (not host function tools). Do not call undeclared functions such as web_search.',
    'On Open Responses, use the declared built-in tools (web_search, web_extractor, code_interpreter) when you need current public information or computation.',
    'Prefer these provider capabilities over guessing facts that may have changed after your knowledge cutoff.',
  ].join('\n');
}

function readResponsesBuiltinToolType(tool: JsonValue): string | undefined {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
    return undefined;
  }

  const record = tool as JsonObject;
  return typeof record.type === 'string' ? record.type : undefined;
}
