import type { JsonObject, JsonValue } from '../ports.js';

export const TOOL_DESCRIBE_TOOL_NAME = 'tool_describe';
export const TOOL_CALL_TOOL_NAME = 'tool_call';

const LAZY_TOOL_PROVIDER_PROPERTY: JsonObject = {
  type: 'string',
  description: 'Tool provider namespace. Only "mcp" is supported in this host.',
  enum: ['mcp'],
};

const LAZY_TOOL_SERVER_PROPERTY: JsonObject = {
  type: 'string',
  description: 'Provider-specific server identifier. For MCP, the configured server name.',
};

const LAZY_TOOL_NAME_PROPERTY: JsonObject = {
  type: 'string',
  description: 'Provider-specific tool name. For MCP, the tool name reported by the server.',
};

export function isLazyToolGatewayToolName(name: string): boolean {
  return name === TOOL_DESCRIBE_TOOL_NAME || name === TOOL_CALL_TOOL_NAME;
}

export function buildLazyToolGatewayDefinitions(): JsonValue[] {
  return [
    lazyToolFunctionDefinition(
      TOOL_DESCRIBE_TOOL_NAME,
      'Fetch the input schema for a lazily loaded tool. Call this before tool_call when argument shape is unclear.',
      {
        type: 'object',
        properties: {
          provider: LAZY_TOOL_PROVIDER_PROPERTY,
          server: LAZY_TOOL_SERVER_PROPERTY,
          tool: LAZY_TOOL_NAME_PROPERTY,
        },
        required: ['provider', 'server', 'tool'],
        additionalProperties: false,
      },
    ),
    lazyToolFunctionDefinition(
      TOOL_CALL_TOOL_NAME,
      'Invoke a lazily loaded tool. Use tool_describe first when you need the input schema.',
      {
        type: 'object',
        properties: {
          provider: LAZY_TOOL_PROVIDER_PROPERTY,
          server: LAZY_TOOL_SERVER_PROPERTY,
          tool: LAZY_TOOL_NAME_PROPERTY,
          arguments: {
            type: 'object',
            description: 'Tool arguments object matching the schema from tool_describe.',
            additionalProperties: true,
          },
        },
        required: ['provider', 'server', 'tool'],
        additionalProperties: false,
      },
    ),
  ];
}

function lazyToolFunctionDefinition(
  name: string,
  description: string,
  parameters: JsonObject,
): JsonValue {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
    },
  };
}
