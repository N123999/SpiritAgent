import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';

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

  constructor(clientInfo: McpClientInfo = DEFAULT_MCP_CLIENT_INFO) {
    this.clientStore = createMcpSdkClient(clientInfo);
  }

  get client(): Client {
    return this.clientStore;
  }

  get connectedServer(): string | undefined {
    return this.serverNameStore;
  }

  async connect(server: ResolvedMcpServerConfig): Promise<void> {
    await this.close();
    const transport = createTransport(server.transport);

    try {
      await this.clientStore.connect(transport as unknown as McpConnectTransport);
    } catch (error) {
      await safeCloseTransport(transport);
      throw new McpConnectionError(`MCP server 连接失败: ${server.name}`, { cause: error });
    }

    this.transportStore = transport;
    this.serverNameStore = server.name;
  }

  async close(): Promise<void> {
    const transport = this.transportStore;
    this.transportStore = undefined;
    this.serverNameStore = undefined;

    if (transport) {
      await transport.close();
    }
  }

  async listTools(): Promise<McpListToolsResult> {
    return this.clientStore.listTools();
  }

  async listResources(): Promise<McpListResourcesResult> {
    return this.clientStore.listResources();
  }

  async listPrompts(): Promise<McpListPromptsResult> {
    return this.clientStore.listPrompts();
  }

  async readResource(uri: string): Promise<McpReadResourceResult> {
    return this.clientStore.readResource({ uri });
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<McpGetPromptResult> {
    return this.clientStore.getPrompt({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    });
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<McpCallToolResult> {
    return this.clientStore.callTool({
      name,
      ...(args === undefined ? {} : { arguments: args }),
    });
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