import type { JsonObject, JsonValue } from './ports.js';
import type { LlmTransportConfig } from './provider-config.js';

export interface JsonSchemaCompletionRequest {
  userPrompt: string;
  schemaName: string;
  schema: JsonObject;
  systemSections?: Array<string | undefined>;
  includeToolAgentHostPrompt?: boolean;
}

export interface JsonSchemaCompletionResult<T extends JsonValue = JsonValue> {
  output: T;
  rawText: string;
  requestTrace: JsonValue[];
}

export interface JsonSchemaTransport {
  createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: LlmTransportConfig,
    request: JsonSchemaCompletionRequest,
  ): Promise<JsonSchemaCompletionResult<T>>;
}
