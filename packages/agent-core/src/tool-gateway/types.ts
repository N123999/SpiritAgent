import type { JsonValue } from '../ports.js';

export const LAZY_TOOL_PROVIDER_MCP = 'mcp';

export interface LazyToolDescribeRequest {
  provider: string;
  server: string;
  tool: string;
}

export interface LazyToolCallRequest {
  provider: string;
  server: string;
  tool: string;
  arguments?: JsonValue;
}

export interface LazyToolDescribeResult {
  description: string;
  inputSchema: JsonValue;
}

export interface LazyToolGatewayBackend {
  describe(request: LazyToolDescribeRequest): Promise<LazyToolDescribeResult>;
  call(request: LazyToolCallRequest): Promise<JsonValue>;
}

export interface LazyToolGatewayToolRequest {
  [key: string]: JsonValue;
  kind: 'lazyToolGateway';
  name: string;
  argumentsJson: string;
}
