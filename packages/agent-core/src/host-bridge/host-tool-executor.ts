import type {
  AuthorizationDecision,
  JsonValue,
  McpStatusSnapshot,
  ToolExecutor,
} from '../ports.js';
import { JsonRpcPeer } from './framing.js';

interface HostToolRequestMetadata {
  backgroundExecution?: boolean;
  backgroundStatusText?: string;
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

  constructor(protected readonly peer: JsonRpcPeer) {}

  async refreshCaches(): Promise<void> {
    this.toolDefinitionsCache = await this.peer.call<JsonValue>('host.toolDefinitionsJson');
    this.mcpStatusSnapshotCache = await this.peer.call<McpStatusSnapshot>('host.mcpStatusSnapshot');
  }

  toolDefinitionsJson(): JsonValue {
    return this.toolDefinitionsCache;
  }

  async parseCommand(message: string): Promise<JsonValue> {
    return this.peer.call<JsonValue>('host.parseCommand', { message });
  }

  async requestFromFunctionCall(name: string, argumentsJson: string): Promise<JsonValue> {
    return this.peer.call<JsonValue>('host.requestFromFunctionCall', { name, argumentsJson });
  }

  async authorize(request: JsonValue): Promise<AuthorizationDecision<JsonValue>> {
    return this.peer.call<AuthorizationDecision<JsonValue>>('host.authorize', { request });
  }

  async trust(target: JsonValue): Promise<void> {
    await this.peer.call('host.trust', { target });
  }

  async execute(request: JsonValue): Promise<string> {
    return this.peer.call<string>('host.execute', { request });
  }

  shouldExecuteInBackground(request: JsonValue): boolean {
    return hostToolRequestMetadata(request)?.backgroundExecution ?? false;
  }

  backgroundStatusText(request: JsonValue): string | undefined {
    return hostToolRequestMetadata(request)?.backgroundStatusText;
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
  };
}