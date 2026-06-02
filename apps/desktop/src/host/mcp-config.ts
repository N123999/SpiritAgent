import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import {
  findMcpServerNameConflict,
  mcpUserConfigPath,
  mcpWorkspaceConfigPath,
  normalizeCapabilityToggles,
  normalizeMcpServerConfig,
  parseMcpConfigFile,
  summarizeTransport,
  type McpConfigFile,
  type McpServerConfig,
} from '@spirit-agent/agent-core';

import type {
  AddMcpServerRequest,
  DesktopMcpScope,
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

export function desktopUserMcpConfigPath(): string {
  return mcpUserConfigPath(spiritAgentDataDir());
}

export function desktopWorkspaceMcpConfigPath(workspaceRoot: string): string {
  return mcpWorkspaceConfigPath(workspaceRoot);
}

export function mcpConfigPathForScope(scope: DesktopMcpScope, workspaceRoot: string): string {
  return scope === 'workspace'
    ? desktopWorkspaceMcpConfigPath(workspaceRoot)
    : desktopUserMcpConfigPath();
}

export function loadMcpConfigFileAt(configPath: string): McpConfigFile {
  if (!existsSync(configPath)) {
    return { servers: {} };
  }

  const content = readFileSync(configPath, 'utf8');
  return parseMcpConfigFile(JSON.parse(content) as unknown);
}

export async function saveMcpConfigFileAt(configPath: string, config: McpConfigFile): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function mapServerListItem(
  name: string,
  server: McpServerConfig,
  scope: DesktopMcpScope,
): DesktopMcpServerListItem {
  const normalized = normalizeMcpServerConfig(name, server);
  switch (normalized.transport.type) {
    case 'stdio':
      return {
        name: normalized.name,
        displayName: normalized.displayName,
        enabled: normalized.enabled,
        capabilities: normalized.capabilities,
        scope,
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
        scope,
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
}

export function listDesktopMcpServersFromDisk(
  workspaceRoot: string,
  workspaceBinding: 'project' | 'none' = 'project',
): DesktopMcpServerListItem[] {
  try {
    const userConfig = loadMcpConfigFileAt(desktopUserMcpConfigPath());
    const userItems = Object.entries(userConfig.servers).map(([name, server]) =>
      mapServerListItem(name, server, 'user'),
    );
    if (workspaceBinding === 'none') {
      return userItems;
    }
    const workspaceConfig = loadMcpConfigFileAt(desktopWorkspaceMcpConfigPath(workspaceRoot));
    const workspaceItems = Object.entries(workspaceConfig.servers).map(([name, server]) =>
      mapServerListItem(name, server, 'workspace'),
    );
    return [...userItems, ...workspaceItems];
  } catch {
    return [];
  }
}

export function assertMcpServerNameAvailable(workspaceRoot: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(i18n.t('error.mcpNameRequired'));
  }

  const userConfig = loadMcpConfigFileAt(desktopUserMcpConfigPath());
  const workspaceConfig = loadMcpConfigFileAt(desktopWorkspaceMcpConfigPath(workspaceRoot));
  if (findMcpServerNameConflict(userConfig, workspaceConfig, trimmed)) {
    throw new Error(i18n.t('error.mcpExists', { name: trimmed }));
  }
}

export async function addMcpServerToDisk(
  scope: DesktopMcpScope,
  workspaceRoot: string,
  name: string,
  config: McpServerConfig,
): Promise<string> {
  assertMcpServerNameAvailable(workspaceRoot, name);
  const configPath = mcpConfigPathForScope(scope, workspaceRoot);
  const configFile = loadMcpConfigFileAt(configPath);
  configFile.servers[name.trim()] = config;
  await saveMcpConfigFileAt(configPath, configFile);
  return configPath;
}

export async function deleteMcpServerFromDisk(
  scope: DesktopMcpScope,
  workspaceRoot: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(i18n.t('error.mcpNameRequired'));
  }

  const configPath = mcpConfigPathForScope(scope, workspaceRoot);
  const configFile = loadMcpConfigFileAt(configPath);
  if (!configFile.servers[trimmed]) {
    throw new Error(i18n.t('error.mcpNotFound', { name: trimmed }));
  }

  delete configFile.servers[trimmed];
  await saveMcpConfigFileAt(configPath, configFile);
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
      throw new Error(i18n.t('error.httpEndpointRequired'));
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(i18n.t('error.httpEndpointInvalidUrl'));
    }
    if (!url.protocol || !url.host) {
      throw new Error(i18n.t('error.httpEndpointMissingSchemeHost'));
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
      throw new Error(i18n.t('error.commandRequired'));
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
        ? i18n.t('error.envFormatInvalid')
        : i18n.t('error.headerFormatInvalid'));
    }

    const key = parsed[0]?.trim() ?? '';
    if (!key) {
      throw new Error(kind === 'env' ? i18n.t('error.envKeyRequired') : i18n.t('error.headerKeyRequired'));
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
      throw new Error(i18n.t('error.unclosedQuote'));
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
