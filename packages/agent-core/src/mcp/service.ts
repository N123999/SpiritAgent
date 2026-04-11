import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { JsonValue } from '../ports.js';
import { resolveEnvRecord, mcpUserConfigPath, normalizeMcpServerConfig } from './config.js';
import { SdkMcpConnection } from './client.js';
import { McpConfigError } from './errors.js';
import { McpRegistry } from './registry.js';
import type {
  McpCapabilityToggles,
  McpConfigFile,
  McpServerConfig,
  ResolvedMcpHttpTransportConfig,
  ResolvedMcpServerConfig,
  ResolvedMcpStdioTransportConfig,
  ResolvedMcpTransportConfig,
} from './types.js';
import {
  buildWindowsCommandCandidates,
  isWindowsPlatform,
  splitWindowsPathEntries,
  splitWindowsPathExtEntries,
} from './windows.js';

const WINDOWS_USER_ENV_REGISTRY_PATH = 'HKCU\\Environment';
const WINDOWS_MACHINE_ENV_REGISTRY_PATH =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

interface LoadedMcpConfig {
  raw: McpConfigFile;
  resolved: Record<string, ResolvedMcpServerConfig>;
}

type EnvLookupStore = Map<string, string>;

export class McpService {
  private readonly registry = new McpRegistry();
  private loadedConfigStore: LoadedMcpConfig = {
    raw: { servers: {} },
    resolved: {},
  };
  private loadErrorStore: string | undefined;
  private windowsEnvLookupPromise: Promise<EnvLookupStore> | undefined;

  constructor(private readonly workspaceRootStore = process.cwd()) {
    this.registry.replaceConfig({ servers: {} });
  }

  statusSnapshot(): {
    revision: number;
    state: 'idle' | 'loading' | 'ready' | 'error';
    configuredServers: number;
    loadedServers: number;
    cachedTools: number;
    lastError?: string;
  } {
    const snapshot = this.registry.snapshot();
    if (this.loadErrorStore === undefined) {
      return snapshot;
    }

    return {
      ...snapshot,
      state: 'error',
      lastError: this.loadErrorStore,
    };
  }

  async refreshConfig(): Promise<void> {
    try {
      const raw = await loadMcpConfigFile(resolveMcpConfigPath());
      const lookup = await this.buildEnvLookupStore();
      const resolvedEntries = await Promise.all(
        Object.entries(raw.servers).map(async ([name, server]) => {
          const resolved = await resolveRuntimeServerConfig(
            name,
            server,
            this.workspaceRootStore,
            lookup,
          );
          return [name, resolved] as const;
        }),
      );

      this.loadedConfigStore = {
        raw,
        resolved: Object.fromEntries(resolvedEntries),
      };
      this.registry.replaceConfig(raw);
      this.loadErrorStore = undefined;
    } catch (error) {
      this.loadErrorStore = describeError(error);
      throw error;
    }
  }

  async startBackgroundRefresh(): Promise<void> {
    await this.refreshConfig();

    for (const server of Object.values(this.loadedConfigStore.resolved)) {
      if (!server.enabled) {
        continue;
      }

      this.registry.setServerState(server.name, 'loading');
      const connection = new SdkMcpConnection();
      try {
        await connection.connect(server);
        const capabilities = connection.serverCapabilities;
        const cachedTools =
          server.capabilities.tools && capabilities?.tools !== undefined
            ? (await connection.listTools()).tools.length
            : 0;
        this.registry.setServerState(server.name, 'ready', { cachedTools });
      } catch (error) {
        this.registry.setServerState(server.name, 'error', {
          lastError: describeError(error),
        });
      } finally {
        await connection.close();
      }
    }
  }

  async listServers(): Promise<JsonValue[]> {
    await this.refreshConfig();

    return Object.entries(this.loadedConfigStore.raw.servers).map(([name, server]) =>
      buildManagedServerForRust(name, server, this.loadedConfigStore.resolved[name]),
    );
  }

  async inspectServer(name: string): Promise<JsonValue> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      const serverVersion = connection.serverVersion;
      const supportsTools = server.capabilities.tools && capabilities?.tools !== undefined;
      const supportsResources =
        server.capabilities.resources && capabilities?.resources !== undefined;
      const supportsPrompts = server.capabilities.prompts && capabilities?.prompts !== undefined;
      const toolsResult = supportsTools ? await connection.listTools() : { tools: [] };
      const resourcesResult = supportsResources
        ? await connection.listResources()
        : { resources: [] };
      const resourceTemplatesResult = supportsResources
        ? await connection.listResourceTemplates()
        : { resourceTemplates: [] };
      const promptsResult = supportsPrompts ? await connection.listPrompts() : { prompts: [] };

      this.registry.setServerState(server.name, 'ready', {
        cachedTools: toolsResult.tools.length,
      });

      return {
        name: server.name,
        displayName: server.displayName,
        protocolVersion: connection.protocolVersion,
        serverName: serverVersion?.name ?? server.name,
        ...(serverVersion?.title === undefined ? {} : { serverTitle: serverVersion.title }),
        serverVersion: serverVersion?.version ?? 'unknown',
        ...(serverVersion?.description === undefined
          ? {}
          : { serverDescription: serverVersion.description }),
        ...(connection.instructions === undefined ? {} : { instructions: connection.instructions }),
        supportsTools,
        supportsResources,
        supportsPrompts,
        supportsLogging: capabilities?.logging !== undefined,
        supportsCompletions: capabilities?.completions !== undefined,
        toolsListChanged: capabilities?.tools?.listChanged ?? false,
        resourcesListChanged: capabilities?.resources?.listChanged ?? false,
        promptsListChanged: capabilities?.prompts?.listChanged ?? false,
        toolsCount: toolsResult.tools.length,
        resourcesCount: resourcesResult.resources.length,
        resourceTemplatesCount: resourceTemplatesResult.resourceTemplates.length,
        promptsCount: promptsResult.prompts.length,
      };
    });
  }

  async listTools(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.tools && capabilities?.tools !== undefined)) {
        this.registry.setServerState(server.name, 'ready', { cachedTools: 0 });
        return [];
      }

      const result = await connection.listTools();
      const tools = result.tools.map((tool) => ({
        name: tool.name,
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.description === undefined ? {} : { description: tool.description }),
        inputSchema: tool.inputSchema as unknown as JsonValue,
      }));
      this.registry.setServerState(server.name, 'ready', { cachedTools: tools.length });
      return tools;
    });
  }

  async listResources(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.resources && capabilities?.resources !== undefined)) {
        this.registry.setServerState(server.name, 'ready');
        return [];
      }

      const result = await connection.listResources();
      this.registry.setServerState(server.name, 'ready');
      return result.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        ...(resource.title === undefined ? {} : { title: resource.title }),
        ...(resource.description === undefined ? {} : { description: resource.description }),
        ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
        ...(resource.size === undefined ? {} : { size: resource.size }),
      }));
    });
  }

  async readResource(name: string, uri: string): Promise<JsonValue> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      assertResourceCapability(server, capabilities);
      const result = await connection.readResource(uri);
      this.registry.setServerState(server.name, 'ready');
      return result as JsonValue;
    });
  }

  async listPrompts(name: string): Promise<JsonValue[]> {
    const server = await this.requireConnectableServer(name);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      if (!(server.capabilities.prompts && capabilities?.prompts !== undefined)) {
        this.registry.setServerState(server.name, 'ready');
        return [];
      }

      const result = await connection.listPrompts();
      this.registry.setServerState(server.name, 'ready');
      return result.prompts.map((prompt) => ({
        name: prompt.name,
        ...(prompt.title === undefined ? {} : { title: prompt.title }),
        ...(prompt.description === undefined ? {} : { description: prompt.description }),
        arguments: (prompt.arguments ?? []).map((argument) => ({
          name: argument.name,
          ...(argument.description === undefined ? {} : { description: argument.description }),
          required: argument.required ?? false,
        })),
      }));
    });
  }

  async getPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue> {
    const server = await this.requireConnectableServer(name);
    const args = parsePromptArguments(argsJson);

    return this.withConnection(server, async (connection) => {
      const capabilities = connection.serverCapabilities;
      assertPromptCapability(server, capabilities);
      const result = await connection.getPrompt(prompt, args);
      this.registry.setServerState(server.name, 'ready');
      return result as JsonValue;
    });
  }

  private async requireConnectableServer(name: string): Promise<ResolvedMcpServerConfig> {
    await this.refreshConfig();
    const server = this.loadedConfigStore.resolved[name];
    if (!server) {
      throw new McpConfigError(`未知 MCP server: ${name}`);
    }
    if (!server.enabled) {
      throw new McpConfigError(`MCP server ${name} 已禁用，请先启用。`);
    }
    return server;
  }

  private async withConnection<T>(
    server: ResolvedMcpServerConfig,
    operation: (connection: SdkMcpConnection) => Promise<T>,
  ): Promise<T> {
    this.registry.setServerState(server.name, 'loading');
    const connection = new SdkMcpConnection();

    try {
      await connection.connect(server);
      return await operation(connection);
    } catch (error) {
      this.registry.setServerState(server.name, 'error', {
        lastError: describeError(error),
      });
      throw error;
    } finally {
      await connection.close();
    }
  }

  private async buildEnvLookupStore(): Promise<EnvLookupStore> {
    const lookup = new Map<string, string>();
    const processKeys = new Set<string>();

    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = normalizeEnvKey(key);
      processKeys.add(normalized);
      lookup.set(normalized, value);
    }

    if (!isWindowsPlatform()) {
      return lookup;
    }

    const persisted = await this.loadWindowsEnvLookupStore();
    for (const [key, value] of persisted) {
      if (processKeys.has(key)) {
        continue;
      }

      lookup.set(key, value);
    }

    return lookup;
  }

  private async loadWindowsEnvLookupStore(): Promise<EnvLookupStore> {
    if (this.windowsEnvLookupPromise) {
      return this.windowsEnvLookupPromise;
    }

    this.windowsEnvLookupPromise = (async () => {
      const lookup = new Map<string, string>();
      const machine = await queryWindowsRegistryEnvironment(WINDOWS_MACHINE_ENV_REGISTRY_PATH);
      const user = await queryWindowsRegistryEnvironment(WINDOWS_USER_ENV_REGISTRY_PATH);

      for (const [key, value] of Object.entries(machine)) {
        lookup.set(normalizeEnvKey(key), value);
      }
      for (const [key, value] of Object.entries(user)) {
        lookup.set(normalizeEnvKey(key), value);
      }

      return lookup;
    })();

    return this.windowsEnvLookupPromise;
  }
}

function resolveMcpConfigPath(): string {
  return mcpUserConfigPath(spiritAgentDataDir());
}

function spiritAgentDataDir(): string {
  const appData = process.env.APPDATA?.trim();
  if (appData) {
    return join(appData, 'SpiritAgent');
  }

  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) {
    return join(userProfile, '.spirit-agent');
  }

  return '.spirit-agent';
}

async function loadMcpConfigFile(path: string): Promise<McpConfigFile> {
  try {
    const content = await readFile(path, 'utf8');
    return JSON.parse(content) as McpConfigFile;
  } catch (error) {
    if (isErrnoWithCode(error, 'ENOENT')) {
      return { servers: {} };
    }

    if (error instanceof SyntaxError) {
      throw new McpConfigError(`解析 MCP 配置失败: ${path}` , { cause: error });
    }

    throw new McpConfigError(`读取 MCP 配置失败: ${path}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

async function resolveRuntimeServerConfig(
  name: string,
  server: McpServerConfig,
  workspaceRoot: string,
  lookup: EnvLookupStore,
): Promise<ResolvedMcpServerConfig> {
  const normalized = normalizeMcpServerConfig(name, server);

  return {
    ...normalized,
    transport: await resolveRuntimeTransportConfig(normalized.transport, workspaceRoot, lookup),
  };
}

async function resolveRuntimeTransportConfig(
  transport: ResolvedMcpTransportConfig,
  workspaceRoot: string,
  lookup: EnvLookupStore,
): Promise<ResolvedMcpTransportConfig> {
  switch (transport.type) {
    case 'stdio': {
      const inheritedEnv = inheritedProcessEnvironment(lookup);
      const resolvedOverrides = resolveEnvRecord(transport.env, (name) => lookupEnvValue(lookup, name));
      const env = {
        ...inheritedEnv,
        ...resolvedOverrides,
      };

      return {
        ...transport,
        command: await resolveStdioCommand(transport.command, env),
        env,
        ...(transport.cwd === undefined ? {} : { cwd: resolveStdioCwd(workspaceRoot, transport.cwd) }),
      };
    }
    case 'http':
      return {
        ...transport,
        headers: resolveEnvRecord(transport.headers, (name) => lookupEnvValue(lookup, name)),
      };
  }
}

async function resolveStdioCommand(command: string, env: Record<string, string>): Promise<string> {
  const trimmed = command.trim();
  const hasDirectorySeparator = trimmed.includes('\\') || trimmed.includes('/');
  if (isAbsolute(trimmed) || hasDirectorySeparator) {
    const resolved = await resolveCommandCandidate(trimmed);
    if (!resolved) {
      throw new McpConfigError(`找不到 MCP 可执行文件: ${trimmed}`);
    }

    return resolved;
  }

  if (!isWindowsPlatform()) {
    return trimmed;
  }

  const pathEntries = splitWindowsPathEntries(env.PATH ?? process.env.PATH);
  const pathExtEntries = splitWindowsPathExtEntries(env.PATHEXT ?? process.env.PATHEXT);
  for (const candidate of buildWindowsCommandCandidates(trimmed, pathEntries, pathExtEntries)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return trimmed;
}

async function resolveCommandCandidate(path: string): Promise<string | undefined> {
  if (isWindowsPlatform() && !/\.[^\\/.]+$/u.test(path)) {
    const extensions = splitWindowsPathExtEntries(process.env.PATHEXT);
    for (const extension of extensions) {
      const candidate = `${path}${extension}`;
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return (await pathExists(path)) ? path : undefined;
}

function resolveStdioCwd(workspaceRoot: string, cwd: string): string {
  return isAbsolute(cwd) ? cwd : join(workspaceRoot, cwd);
}

function inheritedProcessEnvironment(lookup: EnvLookupStore): Record<string, string> {
  const env: Record<string, string> = {};
  const processKeys = new Set<string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') {
      continue;
    }

    env[key] = value;
    processKeys.add(normalizeEnvKey(key));
  }

  for (const [key, value] of lookup) {
    if (processKeys.has(key)) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

function buildManagedServerForRust(
  name: string,
  server: McpServerConfig,
  resolved: ResolvedMcpServerConfig | undefined,
): JsonValue {
  const enabled = server.enabled ?? true;
  const normalizedName = resolved?.name ?? (name.trim() || name);

  return {
    name: normalizedName,
    displayName: server.displayName?.trim() || resolved?.displayName || normalizedName,
    enabled,
    capabilities: capabilityTogglesFromConfig(server.capabilities),
    transport: transportConfigForRust(server.transport),
    state: enabled ? 'ready' : 'disabled',
  };
}

function capabilityTogglesFromConfig(
  capabilities: Partial<McpCapabilityToggles> | undefined,
): JsonValue {
  return {
    tools: capabilities?.tools ?? true,
    resources: capabilities?.resources ?? true,
    prompts: capabilities?.prompts ?? true,
  };
}

function transportConfigForRust(transport: McpServerConfig['transport']): JsonValue {
  switch (transport.type) {
    case 'stdio':
      return {
        type: 'stdio',
        command: transport.command,
        ...(transport.args === undefined ? {} : { args: transport.args }),
        ...(transport.env === undefined ? {} : { env: transport.env }),
        ...(transport.cwd === undefined ? {} : { cwd: transport.cwd }),
        ...(transport.timeoutMs === undefined ? {} : { timeout_ms: transport.timeoutMs }),
      };
    case 'http':
      return {
        type: 'http',
        url: transport.url,
        ...(transport.headers === undefined ? {} : { headers: transport.headers }),
        ...(transport.timeoutMs === undefined ? {} : { timeout_ms: transport.timeoutMs }),
      };
  }
}

function assertResourceCapability(
  server: ResolvedMcpServerConfig,
  capabilities: SdkMcpConnection['serverCapabilities'],
): void {
  if (!server.capabilities.resources) {
    throw new McpConfigError(`MCP server ${server.name} 未启用 resources capability`);
  }
  if (capabilities?.resources === undefined) {
    throw new McpConfigError(`MCP server ${server.name} 不支持 resources capability`);
  }
}

function assertPromptCapability(
  server: ResolvedMcpServerConfig,
  capabilities: SdkMcpConnection['serverCapabilities'],
): void {
  if (!server.capabilities.prompts) {
    throw new McpConfigError(`MCP server ${server.name} 未启用 prompts capability`);
  }
  if (capabilities?.prompts === undefined) {
    throw new McpConfigError(`MCP server ${server.name} 不支持 prompts capability`);
  }
}

function parsePromptArguments(argsJson: string | undefined): Record<string, string> | undefined {
  if (!argsJson?.trim()) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch (error) {
    throw new McpConfigError('MCP prompt 参数必须是合法 JSON', {
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new McpConfigError('MCP prompt 参数必须是 JSON object');
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = stringifyPromptArgumentValue(value);
  }

  return result;
}

function stringifyPromptArgumentValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  return JSON.stringify(value);
}

function lookupEnvValue(lookup: EnvLookupStore, name: string): string | undefined {
  return lookup.get(normalizeEnvKey(name));
}

function normalizeEnvKey(name: string): string {
  return isWindowsPlatform() ? name.toUpperCase() : name;
}

async function queryWindowsRegistryEnvironment(path: string): Promise<Record<string, string>> {
  if (!isWindowsPlatform()) {
    return {};
  }

  const output = await execRegistryQuery(path);
  return parseWindowsRegistryEnvironment(output);
}

function execRegistryQuery(path: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', path],
      {
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }

        resolve(String(stdout));
      },
    );
  });
}

function parseWindowsRegistryEnvironment(output: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('HKEY_')) {
      continue;
    }

    const parts = trimmed.split(/\s{2,}/u);
    if (parts.length < 3) {
      continue;
    }

    const [name, type, ...valueParts] = parts;
    if (name === undefined || type === undefined || !type.startsWith('REG_')) {
      continue;
    }

    values[name] = valueParts.join('  ').trim();
  }

  return values;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code;
}