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