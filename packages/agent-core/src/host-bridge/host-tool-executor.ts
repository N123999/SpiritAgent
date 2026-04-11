import type {
  AuthorizationDecision,
  JsonValue,
  McpStatusSnapshot,
  ToolRequestExecutionMetadata,
  ToolExecutor,
} from '../ports.js';
import { McpService, type McpToolRequest } from '../mcp/service.js';
import { JsonRpcPeer } from './framing.js';

interface HostToolRequestMetadata {
  backgroundExecution?: boolean;
  backgroundStatusText?: string;
  toolCallId?: string;
  toolName?: string;
}

export class HostToolExecutorProxy implements ToolExecutor<JsonValue, JsonValue> {
  private hostToolDefinitionsCache: JsonValue = [];
  private toolDefinitionsCache: JsonValue = [];
  private readonly requestMetadata = new WeakMap<object, HostToolRequestMetadata>();
  private readonly mcp = new McpService();

  constructor(protected readonly peer: JsonRpcPeer) {}

  async refreshCaches(): Promise<void> {
    this.hostToolDefinitionsCache = await this.peer.call<JsonValue>('host.toolDefinitionsJson');
    await this.mcp.ensureToolingCache().catch(() => undefined);
    this.toolDefinitionsCache = mergeToolDefinitions(
      this.hostToolDefinitionsCache,
      this.mcp.toolDefinitionsJson(),
    );
  }

  toolDefinitionsJson(): JsonValue {
    return this.toolDefinitionsCache;
  }

  async parseCommand(message: string): Promise<JsonValue> {
    return this.unwrapHostToolRequest(await this.peer.call<JsonValue>('host.parseCommand', { message }));
  }

  async requestFromFunctionCall(name: string, argumentsJson: string): Promise<JsonValue> {
    const localMcpRequest = await this.mcp.requestFromFunctionCall(name, argumentsJson);
    if (localMcpRequest) {
      return localMcpRequest;
    }

    return this.unwrapHostToolRequest(
      await this.peer.call<JsonValue>('host.requestFromFunctionCall', { name, argumentsJson }),
    );
  }

  async authorize(request: JsonValue): Promise<AuthorizationDecision<JsonValue>> {
    if (this.mcp.isToolRequest(request)) {
      await this.mcp.authorizeToolRequest(request);
      return { kind: 'allowed' };
    }

    return this.peer.call<AuthorizationDecision<JsonValue>>('host.authorize', {
      request: this.serializeRequest(request),
    });
  }

  async trust(target: JsonValue): Promise<void> {
    await this.peer.call('host.trust', { target });
  }

  async execute(request: JsonValue): Promise<string> {
    if (this.mcp.isToolRequest(request)) {
      return this.executeLocalMcpTool(request);
    }

    return this.peer.call<string>('host.execute', { request: this.serializeRequest(request) });
  }

  attachRequestMetadata(request: JsonValue, metadata: ToolRequestExecutionMetadata): JsonValue {
    if (!isJsonObject(request)) {
      return request;
    }

    const existing = this.requestMetadata.get(request) ?? {};
    this.requestMetadata.set(request, {
      ...existing,
      ...(typeof metadata.toolCallId === 'string' ? { toolCallId: metadata.toolCallId } : {}),
      ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
    });
    return request;
  }

  shouldExecuteInBackground(request: JsonValue): boolean {
    if (this.mcp.isToolRequest(request)) {
      return true;
    }

    return this.resolveRequestMetadata(request)?.backgroundExecution ?? false;
  }

  backgroundStatusText(request: JsonValue): string | undefined {
    if (this.mcp.isToolRequest(request)) {
      return this.mcp.backgroundStatusText(request);
    }

    return this.resolveRequestMetadata(request)?.backgroundStatusText;
  }

  startMcpBackgroundRefresh(): void {
    void this.mcp.startBackgroundRefresh().catch(() => undefined);
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    const result = await this.peer.call<string>('host.addMcpServer', { name, config });
    void this.mcp.startBackgroundRefresh().catch(() => undefined);
    return result;
  }

  async createMcpToolRequest(
    server: string,
    toolName: string,
    argsJson?: string,
  ): Promise<McpToolRequest> {
    return this.mcp.createToolRequest(server, toolName, argsJson);
  }

  async callMcpTool(
    server: string,
    toolName: string,
    argsJson?: string,
  ): Promise<JsonValue> {
    return this.mcp.callTool(server, toolName, argsJson);
  }

  async listMcpServers(): Promise<JsonValue[]> {
    return this.mcp.listServers();
  }

  async inspectMcpServer(name: string): Promise<JsonValue> {
    return this.mcp.inspectServer(name);
  }

  async listMcpTools(name: string): Promise<JsonValue[]> {
    return this.mcp.listTools(name);
  }

  async listMcpResources(name: string): Promise<JsonValue[]> {
    return this.mcp.listResources(name);
  }

  async readMcpResource(name: string, uri: string): Promise<JsonValue> {
    return this.mcp.readResource(name, uri);
  }

  async listMcpPrompts(name: string): Promise<JsonValue[]> {
    return this.mcp.listPrompts(name);
  }

  async getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue> {
    return this.mcp.getPrompt(name, prompt, argsJson);
  }

  private unwrapHostToolRequest(value: JsonValue): JsonValue {
    if (!isJsonObject(value) || !('request' in value)) {
      return value;
    }

    const request = value.request;
    const metadata = hostToolRequestMetadata(value);
    if (isJsonObject(request) && metadata) {
      this.requestMetadata.set(request, metadata);
    }
    return request;
  }

  private serializeRequest(request: JsonValue): JsonValue {
    const metadata = this.resolveRequestMetadata(request);
    if (!metadata) {
      return request;
    }

    return {
      request,
      __hostMeta: {
        ...(typeof metadata.backgroundExecution === 'boolean'
          ? { backgroundExecution: metadata.backgroundExecution }
          : {}),
        ...(typeof metadata.backgroundStatusText === 'string'
          ? { backgroundStatusText: metadata.backgroundStatusText }
          : {}),
        ...(typeof metadata.toolCallId === 'string' ? { toolCallId: metadata.toolCallId } : {}),
        ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
      },
    };
  }

  private resolveRequestMetadata(request: JsonValue): HostToolRequestMetadata | undefined {
    if (!isJsonObject(request)) {
      return undefined;
    }

    return this.requestMetadata.get(request);
  }

  private async executeLocalMcpTool(request: McpToolRequest): Promise<string> {
    const metadata = this.resolveRequestMetadata(request);

    try {
      const output = await this.mcp.executeToolRequest(request);
      this.peer.notify('host.localToolExecuted', {
        request,
        output,
        ...(metadata?.toolCallId === undefined ? {} : { toolCallId: metadata.toolCallId }),
        toolName: metadata?.toolName ?? 'mcp_tool',
      });
      return output;
    } catch (error) {
      const message = renderError(error);
      this.peer.notify('host.localToolFailed', {
        request,
        error: message,
        ...(metadata?.toolCallId === undefined ? {} : { toolCallId: metadata.toolCallId }),
        toolName: metadata?.toolName ?? 'mcp_tool',
      });
      throw error;
    }
  }
}

function hostToolRequestMetadata(request: JsonValue): HostToolRequestMetadata | undefined {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return undefined;
  }

  const candidate = request.__hostMeta;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return undefined;
  }

  return {
    ...(typeof candidate.backgroundExecution === 'boolean'
      ? { backgroundExecution: candidate.backgroundExecution }
      : {}),
    ...(typeof candidate.backgroundStatusText === 'string'
      ? { backgroundStatusText: candidate.backgroundStatusText }
      : {}),
    ...(typeof candidate.toolCallId === 'string' ? { toolCallId: candidate.toolCallId } : {}),
    ...(typeof candidate.toolName === 'string' ? { toolName: candidate.toolName } : {}),
  };
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeToolDefinitions(hostDefinitions: JsonValue, mcpDefinitions: JsonValue[]): JsonValue {
  const merged = Array.isArray(hostDefinitions) ? [...hostDefinitions] : [];
  merged.push(...mcpDefinitions);
  return merged;
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}