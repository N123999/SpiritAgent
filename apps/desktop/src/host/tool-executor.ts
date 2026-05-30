import {
  type AskQuestionsResult,
  type DreamHostToolName,
  type LlmTransportConfig,
  type OpenAiModelCompatibilityProfile,
  type OpenAiTransportConfig,
  resolveOpenAiModelCompatibilityProfile,
  createLlmImageContentPart,
  createLlmTextContentPart,
  buildBuiltinHostToolDefinitions,
  buildDreamHostToolDefinitions,
  buildDreamReadHostToolDefinitions,
  assertFinishTaskToolAllowed,
  buildFinishTaskHostToolDefinitions,
  buildTodoHostToolDefinitions,
  AuthorizationDecision,
  createToolExecutionTextOutput,
  JsonValue,
  McpService,
  McpStatusSnapshot,
  type McpToolRequest,
  type ToolExecutionOutput,
  ToolRequestExecutionMetadata,
  ToolExecutor,
} from '@spirit-agent/agent-core';
import {
  type HostDreamScope,
  type HostDreamSourceSessionRef,
  type HostTodoScope,
  type HostExtensionRuntimeBinding,
  type HostFileChangeObserver,
  type HostGeneratedImageFile,
  type HostGeneratedImageSaveRequest,
  type HostBuiltinToolDefinitionEnvironment,
  type HostOperatingSystemInfo,
  type ApprovalLevel,
  NodeHostToolService,
  normalizeApprovalLevel,
  createNoopMcpAdapter,
} from '@spirit-agent/host-internal';

import type { AskQuestionsQuestionSpec } from '../types.js';
import { spiritAgentDataDir } from './storage.js';
import type { DesktopToolRequest } from './contracts.js';

type DesktopDreamToolMode = 'read-only' | 'collector';

const READ_ONLY_DREAM_TOOL_NAMES = new Set<DreamHostToolName>(['dream_list', 'dream_read']);

function isDreamToolRequest(request: DesktopToolRequest): request is Extract<DesktopToolRequest, { name: DreamHostToolName }> {
  return typeof request?.name === 'string' && request.name.startsWith('dream_');
}

export class DesktopToolExecutor
  implements ToolExecutor<DesktopToolRequest, string>
{
  private readonly tools: NodeHostToolService<AskQuestionsQuestionSpec>;
  private readonly mcp: McpService;
  private readonly dreamToolDefinitions: JsonValue[];
  private readonly todoToolDefinitions: JsonValue[];
  private readonly dreamScope: HostDreamScope | undefined;
  private readonly dreamToolMode: DesktopDreamToolMode | undefined;
  private readonly todoScope: HostTodoScope | undefined;
  private extensionToolDefinitions: JsonValue[];
  private loopToolDefinitions: JsonValue[] = [];
  private loopToolExposureEnabled = false;
  private activeModelCompatibilityProfile: OpenAiModelCompatibilityProfile | undefined;
  private imageGenerationAvailable = false;
  private approvalLevel: ApprovalLevel = 'default';

  constructor(
    private readonly workspaceRoot: string,
    options: {
      extensionToolDefinitions?: JsonValue[];
      fileChangeObserver?: HostFileChangeObserver;
      extensions?: HostExtensionRuntimeBinding<unknown>;
      dreamScope?: HostDreamScope;
      dreamToolMode?: DesktopDreamToolMode;
      dreamSourceSession?: HostDreamSourceSessionRef;
      todoScope?: HostTodoScope;
    } = {},
  ) {
    this.mcp = new McpService(workspaceRoot);
    this.extensionToolDefinitions = [...(options.extensionToolDefinitions ?? [])];
    this.dreamScope = options.dreamScope;
    this.todoScope = options.todoScope;
    this.dreamToolMode = options.dreamScope ? (options.dreamToolMode ?? 'collector') : undefined;
    this.dreamToolDefinitions = !options.dreamScope
      ? []
      : this.dreamToolMode === 'read-only'
        ? buildDreamReadHostToolDefinitions()
        : buildDreamHostToolDefinitions();
    this.todoToolDefinitions = options.todoScope ? buildTodoHostToolDefinitions() : [];
    this.tools = new NodeHostToolService<AskQuestionsQuestionSpec>({
      workspaceRoot,
      spiritDataDir: spiritAgentDataDir(),
    }, {
      mcp: createNoopMcpAdapter(),
      getModelCompatibilityProfile: () => this.activeModelCompatibilityProfile,
      getApprovalLevel: () => this.approvalLevel,
      ...(options.fileChangeObserver ? { fileChangeObserver: options.fileChangeObserver } : {}),
      ...(options.extensions ? { extensions: options.extensions } : {}),
      ...(options.dreamScope ? { dreamScope: options.dreamScope } : {}),
      ...(options.dreamSourceSession ? { dreamSourceSession: options.dreamSourceSession } : {}),
      ...(options.todoScope ? { todoScope: options.todoScope } : {}),
    });
  }

  setActiveTransportConfig(
    config: Pick<LlmTransportConfig, 'model' | 'modelCapabilities'> & {
      llmVendor?: OpenAiTransportConfig['llmVendor'];
      imageGeneration?: unknown;
    },
  ): void {
    this.activeModelCompatibilityProfile = resolveOpenAiModelCompatibilityProfile(config as any);
    this.imageGenerationAvailable = config.imageGeneration !== undefined;
  }

  setApprovalLevel(level: ApprovalLevel): void {
    this.approvalLevel = normalizeApprovalLevel(level);
  }

  setLoopToolExposure(loopEnabled: boolean): void {
    this.loopToolExposureEnabled = loopEnabled;
    this.loopToolDefinitions = loopEnabled ? buildFinishTaskHostToolDefinitions() : [];
  }

  approvalLevelSnapshot(): ApprovalLevel {
    return this.approvalLevel;
  }

  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment {
    return this.tools.toolDefinitionEnvironment();
  }

  operatingSystemInfo(): HostOperatingSystemInfo {
    return this.tools.operatingSystemInfo();
  }

  matchesDreamAccess(
    dreamScope: HostDreamScope | undefined,
    dreamToolMode: DesktopDreamToolMode | undefined,
  ): boolean {
    return this.dreamToolMode === dreamToolMode
      && this.dreamScope?.workspaceRoot === dreamScope?.workspaceRoot
      && this.dreamScope?.gitBranch === dreamScope?.gitBranch;
  }

  matchesTodoAccess(todoScope: HostTodoScope | undefined): boolean {
    return this.todoScope?.sessionKey === todoScope?.sessionKey;
  }

  toolDefinitionsJson(): JsonValue {
    const builtinDefinitions = this.imageGenerationAvailable
      ? buildBuiltinHostToolDefinitions(this.tools.toolDefinitionEnvironment())
      : buildBuiltinHostToolDefinitions(this.tools.toolDefinitionEnvironment())
          .filter((definition) => toolDefinitionName(definition) !== 'generate_image');

    return mergeToolDefinitions(
      ...builtinDefinitions,
      ...this.loopToolDefinitions,
      ...this.dreamToolDefinitions,
      ...this.todoToolDefinitions,
      ...this.extensionToolDefinitions,
      ...this.mcp.toolDefinitionsJson(),
    );
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
    assertFinishTaskToolAllowed(name, this.loopToolExposureEnabled);
    const localMcpRequest = await this.mcp.requestFromFunctionCall(name, argumentsJson);
    if (localMcpRequest) {
      return localMcpRequest as unknown as DesktopToolRequest;
    }
    const request = await this.tools.requestFromFunctionCall(name, argumentsJson);
    this.assertAllowedDreamToolRequest(request);
    return request;
  }

  async authorize(
    request: DesktopToolRequest,
  ): Promise<AuthorizationDecision<string>> {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      await this.mcp.authorizeToolRequest(request as unknown as McpToolRequest);
      return { kind: 'allowed' };
    }
    this.assertAllowedDreamToolRequest(request);
    return this.tools.authorize(request);
  }

  async trust(target: string): Promise<void> {
    await this.tools.trust(target);
  }

  async execute(request: DesktopToolRequest): Promise<ToolExecutionOutput> {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      return createToolExecutionTextOutput(
        await this.mcp.executeToolRequest(request as unknown as McpToolRequest),
      );
    }

    this.assertAllowedDreamToolRequest(request);
    const output = await this.tools.execute(request);
    if (typeof output === 'string') {
      return createToolExecutionTextOutput(output);
    }

    return {
      summaryText: output.summaryText,
      content: output.content.map((part) =>
        part.type === 'text'
          ? createLlmTextContentPart(part.text)
          : createLlmImageContentPart(part.path),
      ),
    };
  }

  async saveGeneratedImage(request: HostGeneratedImageSaveRequest): Promise<HostGeneratedImageFile> {
    return this.tools.saveGeneratedImage(request);
  }

  attachRequestMetadata(
    request: DesktopToolRequest,
    metadata: ToolRequestExecutionMetadata,
  ): DesktopToolRequest {
    return this.tools.attachRequestMetadata(request, metadata);
  }

  async continueAfterQuestions(
    request: DesktopToolRequest,
    result: AskQuestionsResult,
  ): Promise<DesktopToolRequest | undefined> {
    if (!isExtensionToolRequest(request)) {
      return undefined;
    }

    request.questions_result = result as JsonValue;
    return request;
  }

  shouldExecuteInBackground(request: DesktopToolRequest): boolean {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      return true;
    }

    return this.tools.shouldExecuteInBackground?.(request) ?? false;
  }

  backgroundStatusText(request: DesktopToolRequest): string | undefined {
    if (this.mcp.isToolRequest(request as JsonValue)) {
      return this.mcp.backgroundStatusText(request as unknown as McpToolRequest);
    }

    return this.tools.backgroundStatusText?.(request);
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

  private assertAllowedDreamToolRequest(request: DesktopToolRequest): void {
    if (!isDreamToolRequest(request)) {
      return;
    }
    if (!this.dreamToolMode) {
      throw new Error(`Dream tools are not enabled for this runtime: ${request.name}`);
    }
    if (this.dreamToolMode === 'read-only' && !READ_ONLY_DREAM_TOOL_NAMES.has(request.name)) {
      throw new Error(`Dream tool is not available in read-only mode: ${request.name}`);
    }
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

function isExtensionToolRequest(request: DesktopToolRequest): request is Extract<
  DesktopToolRequest,
  { name: 'extension_tool' }
> {
  return typeof request === 'object' && request !== null && request.name === 'extension_tool';
}

function mergeToolDefinitions(...definitions: JsonValue[]): JsonValue {
  const seenNames = new Set<string>();

  return definitions.filter((definition) => {
    const name = toolDefinitionName(definition);
    if (!name) {
      return true;
    }
    if (seenNames.has(name)) {
      console.warn(`[desktop-host] duplicate tool definition dropped: ${name}`);
      return false;
    }
    seenNames.add(name);
    return true;
  });
}

function toolDefinitionName(value: JsonValue): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const candidateFunction = 'function' in value ? value.function : undefined;
  if (typeof candidateFunction !== 'object' || candidateFunction === null || Array.isArray(candidateFunction)) {
    return undefined;
  }

  return typeof candidateFunction.name === 'string' ? candidateFunction.name : undefined;
}
