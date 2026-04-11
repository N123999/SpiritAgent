import type {
  AuthorizationDecision,
  JsonValue,
  McpStatusSnapshot,
  ToolRequestExecutionMetadata,
  ToolExecutor,
} from '../ports.js';
import { JsonRpcPeer } from './framing.js';

interface HostToolRequestMetadata {
  backgroundExecution?: boolean;
  backgroundStatusText?: string;
  toolCallId?: string;
  toolName?: string;
}

export class HostToolExecutorProxy implements ToolExecutor<JsonValue, JsonValue> {
  private toolDefinitionsCache: JsonValue = [];
  private mcpStatusSnapshotCache: McpStatusSnapshot = {
    revision: 0,
    state: 'idle',
    configuredServers: 0,
    loadedServers: 0,
    cachedTools: 0,
  };
  private readonly requestMetadata = new WeakMap<object, HostToolRequestMetadata>();

  constructor(protected readonly peer: JsonRpcPeer) {}

  async refreshCaches(): Promise<void> {
    this.toolDefinitionsCache = await this.peer.call<JsonValue>('host.toolDefinitionsJson');
    this.mcpStatusSnapshotCache = await this.peer.call<McpStatusSnapshot>('host.mcpStatusSnapshot');
  }

  toolDefinitionsJson(): JsonValue {
    return this.toolDefinitionsCache;
  }

  async parseCommand(message: string): Promise<JsonValue> {
    return this.unwrapHostToolRequest(await this.peer.call<JsonValue>('host.parseCommand', { message }));
  }

  async requestFromFunctionCall(name: string, argumentsJson: string): Promise<JsonValue> {
    return this.unwrapHostToolRequest(
      await this.peer.call<JsonValue>('host.requestFromFunctionCall', { name, argumentsJson }),
    );
  }

  async authorize(request: JsonValue): Promise<AuthorizationDecision<JsonValue>> {
    return this.peer.call<AuthorizationDecision<JsonValue>>('host.authorize', {
      request: this.serializeRequest(request),
    });
  }

  async trust(target: JsonValue): Promise<void> {
    await this.peer.call('host.trust', { target });
  }

  async execute(request: JsonValue): Promise<string> {
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
    return this.resolveRequestMetadata(request)?.backgroundExecution ?? false;
  }

  backgroundStatusText(request: JsonValue): string | undefined {
    return this.resolveRequestMetadata(request)?.backgroundStatusText;
  }

  startMcpBackgroundRefresh(): void {
    this.peer.notify('host.startMcpBackgroundRefresh');
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.mcpStatusSnapshotCache;
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    return this.peer.call<string>('host.addMcpServer', { name, config });
  }

  async listMcpServers(): Promise<JsonValue[]> {
    return this.peer.call<JsonValue[]>('host.listMcpServers');
  }

  async inspectMcpServer(name: string): Promise<JsonValue> {
    return this.peer.call<JsonValue>('host.inspectMcpServer', { name });
  }

  async listMcpTools(name: string): Promise<JsonValue[]> {
    return this.peer.call<JsonValue[]>('host.listMcpTools', { name });
  }

  async listMcpResources(name: string): Promise<JsonValue[]> {
    return this.peer.call<JsonValue[]>('host.listMcpResources', { name });
  }

  async readMcpResource(name: string, uri: string): Promise<JsonValue> {
    return this.peer.call<JsonValue>('host.readMcpResource', { name, uri });
  }

  async listMcpPrompts(name: string): Promise<JsonValue[]> {
    return this.peer.call<JsonValue[]>('host.listMcpPrompts', { name });
  }

  async getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue> {
    return this.peer.call<JsonValue>('host.getMcpPrompt', { name, prompt, argsJson });
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