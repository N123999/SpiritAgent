import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  mcpUserConfigPath,
  normalizeCapabilityToggles,
  normalizeMcpServerConfig,
  parseMcpConfigFile,
  summarizeTransport,
  type McpConfigFile,
  type McpServerConfig,
} from '@spirit-agent/agent-core';

import type {
  AddMcpServerRequest,
  DesktopMcpServerListItem,
  DesktopSnapshot,
} from '../types.js';
import { spiritAgentDataDir } from './storage.js';

const MCP_DEFAULT_TIMEOUT_MS = 20_000;

type DesktopMcpMetadataKind = 'env' | 'header';

export function emptyMcpStatusSnapshot(): DesktopSnapshot['mcpStatus'] {
  return {
    revision: 0,
    state: 'idle',
    configuredServers: 0,
    loadedServers: 0,
    cachedTools: 0,
  };
}

export function desktopMcpConfigPath(): string {
  return mcpUserConfigPath(spiritAgentDataDir());
}

export function loadMcpConfigFileFromDisk(): McpConfigFile {
  const configPath = desktopMcpConfigPath();
  if (!existsSync(configPath)) {
    return { servers: {} };
  }

  const content = readFileSync(configPath, 'utf8');
  return parseMcpConfigFile(JSON.parse(content) as unknown);
}

export async function saveMcpConfigFileToDisk(config: McpConfigFile): Promise<void> {
  const configPath = desktopMcpConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function listDesktopMcpServersFromDisk(): DesktopMcpServerListItem[] {
  try {
    const configFile = loadMcpConfigFileFromDisk();
    return Object.entries(configFile.servers).map(([name, server]) => {
      const normalized = normalizeMcpServerConfig(name, server);
      switch (normalized.transport.type) {
        case 'stdio':
          return {
            name: normalized.name,
            displayName: normalized.displayName,
            enabled: normalized.enabled,
            capabilities: normalized.capabilities,
            transport: {
              type: 'stdio',
              command: normalized.transport.command,
              args: normalized.transport.args,
              metadata: normalized.transport.env,
              ...(normalized.transport.cwd ? { cwd: normalized.transport.cwd } : {}),
              ...(normalized.transport.timeoutMs !== undefined
                ? { timeoutMs: normalized.transport.timeoutMs }
                : {}),
              summary: summarizeTransport(normalized.transport),
            },
          };
        case 'http':
          return {
            name: normalized.name,
            displayName: normalized.displayName,
            enabled: normalized.enabled,
            capabilities: normalized.capabilities,
            transport: {
              type: 'http',
              url: normalized.transport.url,
              metadata: normalized.transport.headers,
              ...(normalized.transport.timeoutMs !== undefined
                ? { timeoutMs: normalized.transport.timeoutMs }
                : {}),
              summary: summarizeTransport(normalized.transport),
            },
          };
      }
    });
  } catch {
    return [];
  }
}

export function buildMcpServerConfigFromRequest(request: AddMcpServerRequest): McpServerConfig {
  const name = request.name.trim();
  const capabilities = normalizeCapabilityToggles(request.capabilities);
  const metadata = parseDesktopMcpMetadata(
    request.metadata ?? '',
    request.transportType === 'http' ? 'header' : 'env',
  );

  if (request.transportType === 'http') {
    const endpoint = request.endpoint.trim();
    if (!endpoint) {
      throw new Error('HTTP endpoint 不能为空。');
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('HTTP endpoint 必须是合法 URL。');
    }
    if (!url.protocol || !url.host) {
      throw new Error('HTTP endpoint 必须包含 scheme 和 host。');
    }

    return {
      displayName: name,
      enabled: true,
      capabilities,
      transport: {
        type: 'http',
        url: url.toString(),
        ...(Object.keys(metadata).length > 0 ? { headers: metadata } : {}),
        timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
      },
    };
  }

  const tokens = splitDesktopCommandLine(request.endpoint.trim());
  const [command, ...args] = tokens;
  if (!command) {
    throw new Error('命令不能为空。');
  }

  return {
    displayName: name,
    enabled: true,
    capabilities,
    transport: {
      type: 'stdio',
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(metadata).length > 0 ? { env: metadata } : {}),
      timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
    },
  };
}

function parseDesktopMcpMetadata(
  input: string,
  kind: DesktopMcpMetadataKind,
): Record<string, string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const item of trimmed.split(';')) {
    const pair = item.trim();
    if (!pair) {
      continue;
    }

    const parsed = kind === 'env'
      ? pair.split(/=(.*)/su, 2)
      : pair.includes(':')
        ? pair.split(/:(.*)/su, 2)
        : pair.split(/=(.*)/su, 2);

    if (parsed.length < 2) {
      throw new Error(kind === 'env'
        ? '环境变量格式应为 KEY=value；多个条目用分号分隔。'
        : 'Header 格式应为 Key: Value；多个条目用分号分隔。');
    }

    const key = parsed[0]?.trim() ?? '';
    if (!key) {
      throw new Error(kind === 'env' ? '环境变量名不能为空。' : 'Header 名不能为空。');
    }

    result[key] = (parsed[1] ?? '').trim();
  }

  return result;
}

function splitDesktopCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index]!;
    if (quote) {
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      if (ch === '\\' && index + 1 < input.length) {
        current += input[index + 1]!;
        index += 1;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/u.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (ch === '\\' && index + 1 < input.length) {
      current += input[index + 1]!;
      index += 1;
      continue;
    }
    current += ch;
  }

  if (quote) {
    throw new Error('命令格式错误：存在未闭合的引号。');
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
