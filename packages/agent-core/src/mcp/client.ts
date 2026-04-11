import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Implementation, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { DEFAULT_MCP_CLIENT_INFO } from './config.js';
import { McpConnectionError } from './errors.js';
import type {
  McpClientInfo,
  ResolvedMcpHttpTransportConfig,
  ResolvedMcpServerConfig,
  ResolvedMcpStdioTransportConfig,
  ResolvedMcpTransportConfig,
} from './types.js';

export type McpListToolsResult = Awaited<ReturnType<Client['listTools']>>;
export type McpListResourcesResult = Awaited<ReturnType<Client['listResources']>>;
export type McpListResourceTemplatesResult = Awaited<ReturnType<Client['listResourceTemplates']>>;
export type McpListPromptsResult = Awaited<ReturnType<Client['listPrompts']>>;
export type McpReadResourceResult = Awaited<ReturnType<Client['readResource']>>;
export type McpGetPromptResult = Awaited<ReturnType<Client['getPrompt']>>;
export type McpCallToolResult = Awaited<ReturnType<Client['callTool']>>;
type McpSdkTransport = StdioClientTransport | StreamableHTTPClientTransport;
type McpConnectTransport = Parameters<Client['connect']>[0];

export function createMcpSdkClient(
  clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO,
): Client {
  return new Client(
    {
      name: clientInfo.name,
      version: clientInfo.version,
    },
    {
      capabilities: {},
    },
  );
}

export class SdkMcpConnection {
  private readonly clientStore: Client;
  private transportStore: McpSdkTransport | undefined;
  private serverNameStore: string | undefined;
  private timeoutMsStore: number | undefined;
  private protocolVersionStore = LATEST_PROTOCOL_VERSION;

  constructor(clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO) {
    this.clientStore = createMcpSdkClient(clientInfo);
  }

  get client(): Client {
    return this.clientStore;
  }

  get connectedServer(): string | undefined {
    return this.serverNameStore;
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this.clientStore.getServerCapabilities();
  }

  get serverVersion(): Implementation | undefined {
    return this.clientStore.getServerVersion();
  }

  get instructions(): string | undefined {
    return this.clientStore.getInstructions();
  }

  get protocolVersion(): string {
    return this.protocolVersionStore;
  }

  async connect(server: ResolvedMcpServerConfig): Promise<void> {
    await this.close();
    const transport = createTransport(server.transport);
    this.timeoutMsStore = server.transport.timeoutMs;

    try {
      await this.clientStore.connect(transport as unknown as McpConnectTransport, this.requestOptions());
    } catch (error) {
      await safeCloseTransport(transport);
      throw new McpConnectionError(`MCP server 连接失败: ${server.name}`, { cause: error });
    }

    this.transportStore = transport;
    this.serverNameStore = server.name;
    this.protocolVersionStore = resolveProtocolVersion(transport);
  }

  async close(): Promise<void> {
    const transport = this.transportStore;
    this.transportStore = undefined;
    this.serverNameStore = undefined;
    this.timeoutMsStore = undefined;
    this.protocolVersionStore = LATEST_PROTOCOL_VERSION;

    if (transport) {
      await transport.close();
    }
  }

  async listTools(): Promise<McpListToolsResult> {
    return this.clientStore.listTools(undefined, this.requestOptions());
  }

  async listResources(): Promise<McpListResourcesResult> {
    return this.clientStore.listResources(undefined, this.requestOptions());
  }

  async listResourceTemplates(): Promise<McpListResourceTemplatesResult> {
    return this.clientStore.listResourceTemplates(undefined, this.requestOptions());
  }

  async listPrompts(): Promise<McpListPromptsResult> {
    return this.clientStore.listPrompts(undefined, this.requestOptions());
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    return this.clientStore.readResource({ uri }, this.requestOptions());
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult> {
    return this.clientStore.getPrompt({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    }, this.requestOptions());
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<McpCallToolResult> {
    return this.clientStore.callTool({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    }, undefined, this.requestOptions());
  }

  private requestOptions(): { timeout: number } | undefined {
    return this.timeoutMsStore === undefined ? undefined : { timeout: this.timeoutMsStore };
  }
}

export function createTransport(config: ResolvedMcpTransportConfig): McpSdkTransport {
  switch (config.type) {
    case 'stdio':
      return new StdioClientTransport(buildStdioServerParameters(config));
    case 'http':
      return new StreamableHTTPClientTransport(new URL(config.url), {
        ...(Object.keys(config.headers).length > 0
          ? {
              requestInit: {
                headers: config.headers,
              },
            }
          : {}),
      });
  }
}

function buildStdioServerParameters(
  config: ResolvedMcpStdioTransportConfig,
): StdioServerParameters {
  return {
    command: config.command,
    args: config.args,
    env: config.env,
    stderr: config.stderr,
    ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
  };
}

async function safeCloseTransport(transport: McpSdkTransport): Promise<void> {
  try {
    await transport.close();
  } catch {
    return;
  }
}

export function isHttpTransport(
  config: ResolvedMcpTransportConfig,
): config is ResolvedMcpHttpTransportConfig {
  return config.type === 'http';
}

function resolveProtocolVersion(transport: McpSdkTransport): string {
  if (transport instanceof StreamableHTTPClientTransport) {
    return transport.protocolVersion ?? LATEST_PROTOCOL_VERSION;
  }

  return LATEST_PROTOCOL_VERSION;
}