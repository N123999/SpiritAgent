import {
  buildBuiltinHostToolDefinitions,
  AuthorizationDecision,
  JsonValue,
  McpStatusSnapshot,
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

  constructor(
    private readonly workspaceRoot: string,
    fileChangeObserver?: HostFileChangeObserver,
  ) {
    this.tools = new NodeHostToolService<AskQuestionsQuestionSpec>({
      workspaceRoot,
      spiritDataDir: spiritAgentDataDir(),
    }, {
      mcp: createNoopMcpAdapter(),
      ...(fileChangeObserver ? { fileChangeObserver } : {}),
    });
  }

  toolDefinitionsJson(): JsonValue {
    return buildBuiltinHostToolDefinitions(this.tools.toolDefinitionEnvironment());
  }

  async parseCommand(_message: string): Promise<DesktopToolRequest> {
    throw new Error('当前桌面宿主未实现手动工具命令解析。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<DesktopToolRequest> {
    return this.tools.requestFromFunctionCall(name, argumentsJson);
  }

  async authorize(
    request: DesktopToolRequest,
  ): Promise<AuthorizationDecision<string>> {
    return this.tools.authorize(request);
  }

  async trust(target: string): Promise<void> {
    await this.tools.trust(target);
  }

  async execute(request: DesktopToolRequest): Promise<string> {
    return this.tools.execute(request);
  }

  attachRequestMetadata(
    request: DesktopToolRequest,
    metadata: ToolRequestExecutionMetadata,
  ): DesktopToolRequest {
    return this.tools.attachRequestMetadata(request, metadata);
  }

  startMcpBackgroundRefresh(): void {
    this.tools.startMcpBackgroundRefresh();
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.tools.mcpStatusSnapshot();
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    return this.tools.addMcpServer(name, config);
  }

  async listMcpServers(): Promise<unknown[]> {
    return this.tools.listMcpServers();
  }

  async inspectMcpServer(name: string): Promise<unknown> {
    return this.tools.inspectMcpServer(name);
  }

  async listMcpTools(name: string): Promise<unknown[]> {
    return this.tools.listMcpTools(name);
  }

  async listMcpResources(name: string): Promise<unknown[]> {
    return this.tools.listMcpResources(name);
  }

  async readMcpResource(name: string, uri: string): Promise<JsonValue> {
    return this.tools.readMcpResource(name, uri);
  }

  async listCachedMcpPrompts(name: string): Promise<unknown[]> {
    return this.tools.listCachedMcpPrompts(name);
  }

  async listMcpPrompts(name: string): Promise<unknown[]> {
    return this.tools.listMcpPrompts(name);
  }

  async getMcpPrompt(
    name: string,
    prompt: string,
    _argsJson?: string,
  ): Promise<JsonValue> {
    return this.tools.getMcpPrompt(name, prompt, _argsJson);
  }
}
