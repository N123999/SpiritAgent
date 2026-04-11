import { join } from 'node:path';

import { McpConfigError } from './errors.js';
import type {
  McpCapabilityToggles,
  McpConfigFile,
  McpServerConfig,
  McpTransportConfig,
  ResolvedMcpHttpTransportConfig,
  ResolvedMcpServerConfig,
  ResolvedMcpStdioTransportConfig,
  ResolvedMcpTransportConfig,
  McpClientInfo,
} from './types.js';

const ENV_PLACEHOLDER_PREFIX = '${env:';
const DEFAULT_MCP_CONFIG_FILE = 'mcp.json';

export const DEFAULT_MCP_CLIENT_INFO: McpClientInfo = {
  name: '@spirit-agent/agent-core',
  version: '0.1.0',
};

export function mcpUserConfigPath(dataDir: string): string {
  return join(dataDir, DEFAULT_MCP_CONFIG_FILE);
}

export function defaultMcpCapabilityToggles(): McpCapabilityToggles {
  return {
    tools: true,
    resources: true,
    prompts: true,
  };
}

export function normalizeCapabilityToggles(
  capabilities?: Partial<McpCapabilityToggles>,
): McpCapabilityToggles {
  return {
    tools: capabilities?.tools ?? true,
    resources: capabilities?.resources ?? true,
    prompts: capabilities?.prompts ?? true,
  };
}

export function parseMcpConfigFile(raw: unknown): McpConfigFile {
  const root = asRecord(raw, 'MCP 配置根对象必须是 JSON object');
  const rawServers = root.servers;
  if (rawServers === undefined) {
    return { servers: {} };
  }

  const serversRecord = asRecord(rawServers, 'MCP 配置的 servers 字段必须是 JSON object');
  const servers: Record<string, McpServerConfig> = {};

  for (const [name, server] of Object.entries(serversRecord)) {
    servers[name] = parseMcpServerConfig(name, server);
  }

  return { servers };
}

export function normalizeMcpConfigFile(
  config: McpConfigFile,
): Record<string, ResolvedMcpServerConfig> {
  const normalized: Record<string, ResolvedMcpServerConfig> = {};

  for (const [name, server] of Object.entries(config.servers)) {
    normalized[name] = normalizeMcpServerConfig(name, server);
  }

  return normalized;
}

export function normalizeMcpServerConfig(
  name: string,
  server: McpServerConfig,
): ResolvedMcpServerConfig {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new McpConfigError('MCP server 名称不能为空');
  }

  return {
    name: trimmedName,
    displayName: server.displayName?.trim() || trimmedName,
    enabled: server.enabled ?? true,
    capabilities: normalizeCapabilityToggles(server.capabilities),
    transport: normalizeTransportConfig(server.transport),
  };
}

export function normalizeTransportConfig(
  transport: McpTransportConfig,
): ResolvedMcpTransportConfig {
  switch (transport.type) {
    case 'stdio': {
      const command = transport.command.trim();
      if (!command) {
        throw new McpConfigError('stdio MCP transport command 不能为空');
      }

      const base: ResolvedMcpStdioTransportConfig = {
        type: 'stdio',
        command,
        args: [...(transport.args ?? [])],
        env: { ...(transport.env ?? {}) },
        stderr: transport.stderr ?? 'inherit',
        ...(typeof transport.cwd === 'string' && transport.cwd.trim()
          ? { cwd: transport.cwd.trim() }
          : {}),
        ...(typeof transport.timeoutMs === 'number'
          ? { timeoutMs: transport.timeoutMs }
          : {}),
      };
      return base;
    }
    case 'http': {
      const url = transport.url.trim();
      if (!url) {
        throw new McpConfigError('http MCP transport url 不能为空');
      }

      const base: ResolvedMcpHttpTransportConfig = {
        type: 'http',
        url,
        headers: { ...(transport.headers ?? {}) },
        ...(typeof transport.timeoutMs === 'number'
          ? { timeoutMs: transport.timeoutMs }
          : {}),
      };
      return base;
    }
  }
}

export function resolveEnvTemplate(
  value: string,
  lookup: (name: string) => string | undefined,
): string {
  let rendered = '';
  let remaining = value;

  while (true) {
    const start = remaining.indexOf(ENV_PLACEHOLDER_PREFIX);
    if (start < 0) {
      rendered += remaining;
      return rendered;
    }

    rendered += remaining.slice(0, start);
    const placeholder = remaining.slice(start + ENV_PLACEHOLDER_PREFIX.length);
    const end = placeholder.indexOf('}');
    if (end < 0) {
      throw new McpConfigError(`非法环境变量占位符: ${value}`);
    }

    const envName = placeholder.slice(0, end).trim();
    if (!envName) {
      throw new McpConfigError(`非法环境变量占位符: ${value}`);
    }

    const resolved = lookup(envName);
    if (resolved === undefined) {
      throw new McpConfigError(`缺少环境变量 ${envName}（来自 MCP 配置）`);
    }

    rendered += resolved;
    remaining = placeholder.slice(end + 1);
  }
}

export function resolveEnvRecord(
  entries: Record<string, string>,
  lookup: (name: string) => string | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(entries)) {
    resolved[key] = resolveEnvTemplate(value, lookup);
  }

  return resolved;
}

export function summarizeTransport(transport: ResolvedMcpTransportConfig): string {
  switch (transport.type) {
    case 'stdio': {
      const argsText = transport.args.length > 0 ? ` ${transport.args.join(' ')}` : '';
      const cwdText = transport.cwd ? `, cwd=${transport.cwd}` : '';
      const timeoutText = transport.timeoutMs !== undefined ? `, timeout=${transport.timeoutMs}ms` : '';
      return `stdio ${transport.command}${argsText}${cwdText}${timeoutText}`;
    }
    case 'http': {
      const timeoutText = transport.timeoutMs !== undefined ? `, timeout=${transport.timeoutMs}ms` : '';
      return `http ${transport.url}${timeoutText}`;
    }
  }
}

export function summarizeCapabilities(capabilities: McpCapabilityToggles): string {
  const enabled: string[] = [];
  if (capabilities.tools) {
    enabled.push('tools');
  }
  if (capabilities.resources) {
    enabled.push('resources');
  }
  if (capabilities.prompts) {
    enabled.push('prompts');
  }
  return enabled.length > 0 ? enabled.join(', ') : 'none';
}

function parseMcpServerConfig(name: string, raw: unknown): McpServerConfig {
  const record = asRecord(raw, `MCP server ${name} 配置必须是 JSON object`);
  const nestedTransport = asRecordOrUndefined(record.transport);
  const displayName = readOptionalString(record, ['displayName', 'display_name']);
  const capabilities = parseCapabilityToggles(record.capabilities);

  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(capabilities === undefined ? {} : { capabilities }),
    transport: parseTransportConfigForConfig(name, nestedTransport ?? record),
  };
}

function parseCapabilityToggles(
  raw: unknown,
): Partial<McpCapabilityToggles> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const record = asRecord(raw, 'MCP capabilities 配置必须是 JSON object');
  const toggles: Partial<McpCapabilityToggles> = {};

  if (typeof record.tools === 'boolean') {
    toggles.tools = record.tools;
  }
  if (typeof record.resources === 'boolean') {
    toggles.resources = record.resources;
  }
  if (typeof record.prompts === 'boolean') {
    toggles.prompts = record.prompts;
  }

  return Object.keys(toggles).length > 0 ? toggles : undefined;
}

function parseTransportConfigForConfig(
  serverName: string,
  raw: Record<string, unknown>,
): McpTransportConfig {
  const type = readOptionalString(raw, ['type'])?.trim().toLowerCase();
  switch (type) {
    case 'stdio': {
      const args = readOptionalStringArray(raw, ['args']);
      const env = readOptionalStringRecord(raw, ['env']);
      const cwd = readOptionalString(raw, ['cwd']);
      const timeoutMs = readOptionalNumber(raw, ['timeoutMs', 'timeout_ms']);
      const stderr = readOptionalEnum(raw, ['stderr'], ['inherit', 'pipe']);
      return {
        type: 'stdio',
        command: readRequiredString(raw, ['command'], `MCP server ${serverName} 的 stdio command 不能为空`),
        ...(args === undefined ? {} : { args }),
        ...(env === undefined ? {} : { env }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(stderr === undefined ? {} : { stderr }),
      };
    }
    case 'http': {
      const headers = readOptionalStringRecord(raw, ['headers']);
      const timeoutMs = readOptionalNumber(raw, ['timeoutMs', 'timeout_ms']);
      return {
        type: 'http',
        url: readRequiredString(raw, ['url'], `MCP server ${serverName} 的 http url 不能为空`),
        ...(headers === undefined ? {} : { headers }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      };
    }
    default:
      throw new McpConfigError(`MCP server ${serverName} 缺少有效的 transport.type`);
  }
}

function asRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new McpConfigError(errorMessage);
  }

  return value as Record<string, unknown>;
}

function asRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function firstDefined(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function readOptionalString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  const value = firstDefined(record, keys);
  return typeof value === 'string' ? value : undefined;
}

function readRequiredString(
  record: Record<string, unknown>,
  keys: string[],
  errorMessage: string,
): string {
  const value = readOptionalString(record, keys)?.trim();
  if (!value) {
    throw new McpConfigError(errorMessage);
  }

  return value;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  const value = firstDefined(record, keys);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  const value = firstDefined(record, keys);
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function readOptionalStringRecord(
  record: Record<string, unknown>,
  keys: string[],
): Record<string, string> | undefined {
  const value = firstDefined(record, keys);
  const candidate = asRecordOrUndefined(value);
  if (!candidate) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(candidate)) {
    if (typeof entry === 'string') {
      normalized[key] = entry;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function readOptionalEnum<T extends string>(
  record: Record<string, unknown>,
  keys: string[],
  values: readonly T[],
): T | undefined {
  const value = firstDefined(record, keys);
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : undefined;
}
