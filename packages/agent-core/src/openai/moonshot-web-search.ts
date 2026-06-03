import type { JsonObject, JsonValue } from '../ports.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import {
  buildMoonshotBuiltinWebSearchToolDefinition,
  shouldDisableMoonshotThinkingForWebSearch,
  shouldUseProviderWebSearch,
} from '../open-responses/web-search-eligibility.js';
import { cloneJsonValue } from '../tool-agent.js';

export function moonshotWebSearchEnabled(config: OpenAiTransportConfig): boolean {
  return shouldUseProviderWebSearch(config);
}

export function mergeMoonshotWebSearchToolsForTrace(
  config: OpenAiTransportConfig,
  tools: readonly unknown[],
): JsonValue[] {
  const traceTools = tools.map((tool) => cloneJsonValue(tool as JsonValue));
  if (!moonshotWebSearchEnabled(config)) {
    return traceTools;
  }

  if (traceTools.some((tool) => isMoonshotBuiltinWebSearchTraceTool(tool))) {
    return traceTools;
  }

  traceTools.push(cloneJsonValue(buildMoonshotBuiltinWebSearchToolDefinition() as JsonValue));
  return traceTools;
}

export function mergeMoonshotWebSearchIntoChatCompletionBody(
  config: OpenAiTransportConfig,
  body: JsonObject,
): JsonObject {
  if (!moonshotWebSearchEnabled(config)) {
    return body;
  }

  const existingTools = Array.isArray(body.tools) ? [...body.tools] : [];
  if (existingTools.some((tool) => isMoonshotBuiltinWebSearchTraceTool(tool))) {
    return body;
  }

  return {
    ...body,
    tools: [
      ...existingTools,
      cloneJsonValue(buildMoonshotBuiltinWebSearchToolDefinition() as JsonValue),
    ],
  };
}

export function moonshotThinkingDisabledForWebSearch(config: OpenAiTransportConfig): boolean {
  return shouldDisableMoonshotThinkingForWebSearch(config);
}

function isMoonshotBuiltinWebSearchTraceTool(tool: JsonValue): boolean {
  if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
    return false;
  }

  const record = tool as JsonObject;
  if (record.type !== 'builtin_function') {
    return false;
  }

  const fn = record.function;
  if (typeof fn !== 'object' || fn === null || Array.isArray(fn)) {
    return false;
  }

  return (fn as JsonObject).name === '$web_search';
}
