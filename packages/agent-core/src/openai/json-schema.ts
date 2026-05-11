import type { JsonObject, JsonValue } from '../ports.js';
import {
  buildToolAgentSystemMessage,
  cloneJsonValue,
  isJsonObject,
} from '../tool-agent.js';

import type { OpenAiTransportConfig } from './openai-compat.js';

export interface OpenAiJsonSchemaCompletionRequest {
  userPrompt: string;
  schemaName: string;
  schema: JsonObject;
  systemSections?: Array<string | undefined>;
  includeToolAgentHostPrompt?: boolean;
}

export interface OpenAiJsonSchemaCompletionResult<T extends JsonValue = JsonValue> {
  output: T;
  rawText: string;
  requestTrace: JsonValue[];
}

export interface OpenAiJsonSchemaTransport {
  createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>>;
}

export type StructuredOutputResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict: true;
        schema: JsonObject;
      };
    };

export function buildJsonSchemaCompletionMessages(
  config: Pick<OpenAiTransportConfig, 'model' | 'llmVendor'>,
  request: OpenAiJsonSchemaCompletionRequest,
): JsonValue[] {
  const structuredOutputSystemSection = buildStructuredOutputSystemSection(config, request);
  const sections = [...(request.systemSections ?? []), structuredOutputSystemSection]
    .filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
    .map((section) => section.trim());
  return [
    {
      role: 'system',
      content:
        request.includeToolAgentHostPrompt === false
          ? sections.join('\n\n')
          : buildToolAgentSystemMessage(config.model, ...sections),
    },
    {
      role: 'user',
      content: request.userPrompt,
    },
  ];
}

export function extractJsonSchemaCompletionContent(response: {
  choices?: Array<{ message?: { content?: string | null } }>;
}): string {
  const content = response.choices?.at(0)?.message?.content?.trim() ?? '';
  if (!content) {
    throw new Error('结构化输出返回为空。');
  }

  return content;
}

export function parseJsonSchemaCompletionOutput<T extends JsonValue = JsonValue>(content: string): T {
  const candidates = collectJsonParseCandidates(content);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue trying progressively looser candidates.
    }
  }

  throw new Error('结构化输出不是合法 JSON。');
}

export function stringifyJsonSchemaCompletionOutput(output: JsonValue): string {
  return JSON.stringify(cloneJsonValue(output));
}

export function buildStructuredOutputResponseFormat(
  config: Pick<OpenAiTransportConfig, 'llmVendor'>,
  request: OpenAiJsonSchemaCompletionRequest,
): StructuredOutputResponseFormat {
  if (config.llmVendor === 'deepseek') {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: request.schemaName,
      strict: true,
      schema: request.schema,
    },
  };
}

export function buildStructuredOutputSystemSection(
  config: Pick<OpenAiTransportConfig, 'llmVendor'>,
  request: OpenAiJsonSchemaCompletionRequest,
): string | undefined {
  if (config.llmVendor !== 'deepseek') {
    return undefined;
  }

  const example = buildJsonSchemaExample(request.schema);
  return [
    'Return only raw json that matches the requested schema.',
    'Do not add Markdown code fences, explanations, or any extra text.',
    `Schema name: ${request.schemaName}`,
    '[JSON_SCHEMA]',
    JSON.stringify(request.schema),
    ...(example === undefined
      ? []
      : ['[JSON_EXAMPLE]', JSON.stringify(example, null, 2)]),
  ].join('\n');
}

function collectJsonParseCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const next = value?.trim();
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };

  push(trimmed);

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  push(fenceMatch?.[1]);

  const firstObjectStart = trimmed.indexOf('{');
  const lastObjectEnd = trimmed.lastIndexOf('}');
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    push(trimmed.slice(firstObjectStart, lastObjectEnd + 1));
  }

  const firstArrayStart = trimmed.indexOf('[');
  const lastArrayEnd = trimmed.lastIndexOf(']');
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    push(trimmed.slice(firstArrayStart, lastArrayEnd + 1));
  }

  return candidates;
}

function buildJsonSchemaExample(schema: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(schema)) {
    return undefined;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return cloneJsonValue(schema.enum[0] as JsonValue);
  }

  if (schema.type === 'object' && isJsonObject(schema.properties)) {
    const example: JsonObject = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      example[key] = buildJsonSchemaExample(value as JsonValue) ?? null;
    }
    return example;
  }

  if (schema.type === 'array') {
    return [];
  }

  switch (schema.type) {
    case 'string':
      return '';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}