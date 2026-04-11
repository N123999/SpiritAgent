import type { JsonValue } from '../ports.js';
import { summarizeTransport } from './config.js';
import type { ResolvedMcpTransportConfig } from './types.js';

export type McpTraceOperation =
  | 'connect'
  | 'disconnect'
  | 'inspect'
  | 'list-tools'
  | 'list-resources'
  | 'read-resource'
  | 'list-prompts'
  | 'get-prompt'
  | 'call-tool';

export interface McpTraceEntry {
  kind: 'mcp';
  timestamp: string;
  server: string;
  operation: McpTraceOperation;
  transport: string;
  ok: boolean;
  durationMs: number;
  details?: JsonValue;
  error?: string;
}

export function buildMcpTraceEntry(input: {
  server: string;
  operation: McpTraceOperation;
  transport: ResolvedMcpTransportConfig;
  ok: boolean;
  durationMs: number;
  timestamp?: string;
  details?: JsonValue;
  error?: string;
}): McpTraceEntry {
  return {
    kind: 'mcp',
    timestamp: input.timestamp ?? new Date().toISOString(),
    server: input.server,
    operation: input.operation,
    transport: summarizeTransport(input.transport),
    ok: input.ok,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.error === undefined ? {} : { error: input.error }),
  };
}