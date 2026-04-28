import {
  buildBuiltinHostToolDefinitions,
  AuthorizationDecision,
  JsonValue,
  McpService,
  McpStatusSnapshot,
  type McpToolRequest,
  ToolRequestExecutionMetadata,
  ToolExecutor,
} from '@spirit-agent/agent-core';
import {
  type HostFileChangeObserver,
  NodeHostToolService,
  createNoopMcpAdapter,
} from '@spirit-agent/host-internal';

import type { AskQuestionsQuestionSpec } from '../types.js';
import { spiritAgentDataDir } from './storage.js';
import type { DesktopToolRequest } from './contracts.js';

export class DesktopToolExecutor
  implements ToolExecutor<DesktopToolRequest, string>
{
  private readonly tools: NodeHostToolService<AskQuestionsQuestionSpec>;
  private readonly mcp: McpService;
  private extensionToolDefinitions: JsonValue[];

  constructor(
    private readonly workspaceRoot: string,
    extensionToolDefinitions: JsonValue[] = [],
    fileChangeObserver?: HostFileChangeObserver,
  ) {
    this.mcp = new McpService(workspaceRoot);
    this.extensionToolDefinitions = [...extensionToolDefinitions];
    this.tools = new NodeHostToolService<AskQuestionsQuestionSpec>({
      workspaceRoot,
      spiritDataDir: spiritAgentDataDir(),
    }, {
      mcp: createNoopMcpAdapter(),
      ...(fileChangeObserver ? { fileChangeObserver } : {}),
    });
  }

  toolDefinitionsJson(): JsonValue {
    return [
      ...buildBuiltinHostToolDefinitions(this.tools.toolDefinitionEnvironment()),
      ...this.extensionToolDefinitions,
      ...this.mcp.toolDefinitionsJson(),
    ];
  }

  setExtensionToolDefinitions(definitions: JsonValue[] | undefined): void {
    this.extensionToolDefinitions = Array.isArray(definitions) ? [...definitions] : [];
  }

  async parseCommand(_message: string): Promise<DesktopToolRequest> {
    throw new Error('当前桌面宿主未实现手动工具命令解析。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<DesktopToolRequest> {
    const localMcpRequest = await this.mcp.requestFromFunctionCall(name, argumentsJson);
    if (localMcpRequest) {
      return localMcpRequest as unknown as DesktopToolRequest;
    }
    return this.tools.requestFromFunctionCall(name, argumentsJson);
  }

  async authorize(
    request: DesktopToolRequest,
  ): Promise<AuthorizationDecision<string>> {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      await this.mcp.authorizeToolRequest(request as unknown as McpToolRequest);
      return { kind: 'allowed' };
    }
    return this.tools.authorize(request);
  }

  async trust(target: string): Promise<void> {
    await this.tools.trust(target);
  }

  async execute(request: DesktopToolRequest): Promise<string> {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      return this.mcp.executeToolRequest(request as unknown as McpToolRequest);
    }
    return this.tools.execute(request);
  }

  attachRequestMetadata(
    request: DesktopToolRequest,
    metadata: ToolRequestExecutionMetadata,
  ): DesktopToolRequest {
    return this.tools.attachRequestMetadata(request, metadata);
  }

  startMcpBackgroundRefresh(): void {
    this.mcp.startBackgroundRefreshInBackground(true);
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    return this.tools.addMcpServer(name, config);
  }

  async listMcpServers(): Promise<unknown[]> {
    return this.mcp.listServers();
  }

  async inspectMcpServer(name: string): Promise<unknown> {
    return this.mcp.inspectServer(name);
  }

  async listMcpTools(name: string): Promise<unknown[]> {
    return this.mcp.listTools(name);
  }

  async listMcpResources(name: string): Promise<unknown[]> {
    return this.mcp.listResources(name);
  }

  async readMcpResource(name: string, uri: string): Promise<JsonValue> {
    return this.mcp.readResource(name, uri);
  }

  async listCachedMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listCachedPrompts(name);
  }

  async listMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listPrompts(name);
  }

  async getMcpPrompt(
    name: string,
    prompt: string,
    _argsJson?: string,
  ): Promise<JsonValue> {
    return this.mcp.getPrompt(name, prompt, _argsJson);
  }
}
