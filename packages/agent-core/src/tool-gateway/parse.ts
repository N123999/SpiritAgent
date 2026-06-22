import { McpConfigError } from '../mcp/errors.js';
import type { JsonValue } from '../ports.js';
import {
  LAZY_TOOL_PROVIDER_MCP,
  type LazyToolCallRequest,
  type LazyToolDescribeRequest,
} from './types.js';
import { TOOL_CALL_TOOL_NAME, TOOL_DESCRIBE_TOOL_NAME } from './definitions.js';

export function parseLazyToolGatewayArguments(
  toolName: string,
  argumentsJson: string,
): LazyToolDescribeRequest | LazyToolCallRequest {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(argumentsJson) as JsonValue;
  } catch {
    throw new McpConfigError(`Invalid JSON arguments for ${toolName}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new McpConfigError(`${toolName} arguments must be a JSON object`);
  }

  const provider = readRequiredString(parsed, 'provider');
  const server = readRequiredString(parsed, 'server');
  const tool = readRequiredString(parsed, 'tool');

  if (provider !== LAZY_TOOL_PROVIDER_MCP) {
    throw new McpConfigError(`Unsupported lazy tool provider: ${provider}`);
  }

  if (toolName === TOOL_DESCRIBE_TOOL_NAME) {
    return { provider, server, tool };
  }

  if (toolName === TOOL_CALL_TOOL_NAME) {
    const argsValue = parsed.arguments;
    if (argsValue === undefined) {
      return { provider, server, tool };
    }
    if (typeof argsValue !== 'object' || argsValue === null || Array.isArray(argsValue)) {
      throw new McpConfigError('tool_call arguments must be a JSON object when provided');
    }
    return { provider, server, tool, arguments: argsValue as JsonValue };
  }

  throw new McpConfigError(`Unknown lazy tool gateway name: ${toolName}`);
}

function readRequiredString(value: Record<string, JsonValue>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new McpConfigError(`Missing or invalid "${key}" for lazy tool gateway call`);
  }
  return candidate.trim();
}
