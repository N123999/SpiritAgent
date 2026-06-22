import { McpConfigError } from '../mcp/errors.js';
import type { McpService } from '../mcp/service.js';
import type { JsonValue } from '../ports.js';
import { TOOL_CALL_TOOL_NAME, TOOL_DESCRIBE_TOOL_NAME } from './definitions.js';
import { parseLazyToolGatewayArguments } from './parse.js';
import type { LazyToolGatewayBackend, LazyToolGatewayToolRequest } from './types.js';

export function createMcpLazyToolGatewayBackend(mcpService: McpService): LazyToolGatewayBackend {
  return {
    describe: (request) => mcpService.describeTool(request.server, request.tool),
    call: async (request) => {
      const argsJson =
        request.arguments === undefined ? undefined : JSON.stringify(request.arguments);
      const mcpRequest = await mcpService.createToolRequest(request.server, request.tool, argsJson);
      return mcpService.callToolRequest(mcpRequest);
    },
  };
}

export async function executeLazyToolGatewayCall(
  toolName: string,
  argumentsJson: string,
  backend: LazyToolGatewayBackend,
): Promise<string> {
  if (toolName !== TOOL_DESCRIBE_TOOL_NAME && toolName !== TOOL_CALL_TOOL_NAME) {
    throw new McpConfigError(`Unknown lazy tool gateway name: ${toolName}`);
  }

  const parsed = parseLazyToolGatewayArguments(toolName, argumentsJson);
  if (toolName === TOOL_DESCRIBE_TOOL_NAME) {
    const result = await backend.describe(parsed);
    return JSON.stringify(result, null, 2);
  }

  const callRequest = parsed as Parameters<LazyToolGatewayBackend['call']>[0];
  const result = await backend.call(callRequest);
  return JSON.stringify(result, null, 2);
}

export function isLazyToolGatewayToolRequest(value: JsonValue): value is LazyToolGatewayToolRequest {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && value.kind === 'lazyToolGateway'
    && typeof value.name === 'string'
    && typeof value.argumentsJson === 'string'
  );
}
