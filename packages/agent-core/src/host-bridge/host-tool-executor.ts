import type {
  AskQuestionsResult,
  AuthorizationDecision,
  GeneratedImageFile,
  GeneratedImageSaveRequest,
  JsonValue,
  McpStatusSnapshot,
  ToolExecutionOutput,
  ToolRequestExecutionMetadata,
  ToolExecutor,
} from '../ports.js';
import { createToolExecutionTextOutput } from '../ports.js';
import type { LlmTransportConfig } from '../provider-config.js';
import {
  filterLegacyHostFileToolDefinitions,
  shouldUseApplyPatchFileTools,
} from '../open-responses/apply-patch-eligibility.js';
import { isOpenResponsesTransportConfig } from '../provider-config.js';
import type { SpiritAgentMode } from '../ports.js';
import {
  assertAgentModeAllowsHostTool,
  assertFinishTaskToolAllowed,
  buildBuiltinHostToolDefinitions,
  buildFinishTaskHostToolDefinitions,
  buildPlanModeHostToolDefinitions,
  filterHostToolDefinitionsForAgentMode,
  isPlanAgentMode,
  type BuiltinHostToolDefinitionEnvironment,
} from '../host-tools.js';
import { enrichUnknownToolError, toolNamesFromDefinitions } from '../unknown-tool-error.js';
import { LspService } from '../lsp/service.js';
import { buildLspHostToolDefinitions } from '../lsp/tool-definitions.js';
import {
  isLspDiagnosticsToolRequest,
  requestFromGetDiagnosticsFunctionCall,
} from '../lsp/tool-request.js';
import { appendLspDiagnosticsAfterWriteIfNeeded } from '../lsp/write-append.js';
import { McpService, type McpToolRequest } from '../mcp/service.js';
import { JsonRpcPeer } from './framing.js';

interface HostToolRequestMetadata {
  backgroundExecution?: boolean;
  backgroundStatusText?: string;
  toolCallId?: string;
  toolName?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
  userInitiated?: boolean;
}

export interface LocalHostToolService {
  toolDefinitionEnvironment(): BuiltinHostToolDefinitionEnvironment;
  operatingSystemInfo?(): { name: string; version: string };
  parseCommand(message: string): Promise<JsonValue>;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<JsonValue>;
  authorize(request: JsonValue): Promise<AuthorizationDecision<JsonValue>>;
  trust(target: string): Promise<void>;
  execute(request: JsonValue): Promise<ToolExecutionOutput | string>;
  saveGeneratedImage?(request: GeneratedImageSaveRequest): Promise<GeneratedImageFile>;
  attachRequestMetadata?(request: JsonValue, metadata: ToolRequestExecutionMetadata): JsonValue;
}

export class HostToolExecutorProxy implements ToolExecutor<JsonValue, JsonValue> {
  private hostToolDefinitionsCache: JsonValue = [];
  private extensionToolDefinitionsCache: JsonValue[] = [];
  private todoToolDefinitionsCache: JsonValue[] = [];
  private loopToolDefinitionsCache: JsonValue[] = [];
  private loopToolExposureEnabled = false;
  private planToolDefinitionsCache: JsonValue[] = [];
  private agentMode: SpiritAgentMode = 'agent';
  private hostToolDefinitionsLoaded = false;
  private toolDefinitionsCache: JsonValue = [];
  private readonly requestMetadata = new WeakMap<object, HostToolRequestMetadata>();
  private readonly mcp = new McpService();
  private lsp: LspService | undefined;
  private localHostService: LocalHostToolService | undefined;
  private imageGenerationAvailable = false;
  private transportConfigForToolDefinitions: LlmTransportConfig | undefined;

  constructor(protected readonly peer: JsonRpcPeer) {}

  setTransportConfigForToolDefinitions(config: LlmTransportConfig | undefined): void {
    this.transportConfigForToolDefinitions = config;
    this.refreshMergedToolDefinitions();
  }

  setLocalHostService(service: LocalHostToolService | undefined): void {
    this.localHostService = service;
    this.hostToolDefinitionsLoaded = false;
    this.hostToolDefinitionsCache = [];
    this.refreshMergedToolDefinitions();
  }

  setImageGenerationAvailable(available: boolean): void {
    this.imageGenerationAvailable = available;
    this.refreshMergedToolDefinitions();
  }

  setExtensionToolDefinitions(definitions: JsonValue[] | undefined): void {
    this.extensionToolDefinitionsCache = Array.isArray(definitions) ? [...definitions] : [];
    this.refreshMergedToolDefinitions();
  }

  setTodoToolDefinitions(definitions: JsonValue[] | undefined): void {
    this.todoToolDefinitionsCache = Array.isArray(definitions) ? [...definitions] : [];
    this.refreshMergedToolDefinitions();
  }

  setLoopToolExposure(loopEnabled: boolean): void {
    this.loopToolExposureEnabled = loopEnabled;
    this.loopToolDefinitionsCache = loopEnabled ? buildFinishTaskHostToolDefinitions() : [];
    this.refreshMergedToolDefinitions();
  }

  setAgentModeToolExposure(agentMode: SpiritAgentMode): void {
    this.agentMode = agentMode;
    this.planToolDefinitionsCache = isPlanAgentMode(agentMode) ? buildPlanModeHostToolDefinitions() : [];
    this.refreshMergedToolDefinitions();
  }

  setPlanModeToolExposure(planMode: boolean): void {
    this.setAgentModeToolExposure(planMode ? 'plan' : 'agent');
  }

  async setLspWorkspaceRoot(workspaceRoot: string): Promise<void> {
    await this.lsp?.dispose();
    this.lsp = undefined;
    const lsp = new LspService(workspaceRoot);
    await lsp.probe();
    this.lsp = lsp.enabled ? lsp : undefined;
    this.refreshMergedToolDefinitions();
  }

  lspServiceSnapshot(): LspService | undefined {
    return this.lsp;
  }

  async disposeLsp(): Promise<void> {
    await this.lsp?.dispose();
    this.lsp = undefined;
    this.refreshMergedToolDefinitions();
  }

  async refreshCaches(): Promise<void> {
    if (!this.hostToolDefinitionsLoaded) {
      this.hostToolDefinitionsCache = buildBuiltinHostToolDefinitions(
        this.localHostService
          ? this.localHostService.toolDefinitionEnvironment()
          : parseBuiltinHostToolDefinitionEnvironment(
              await this.peer.call<JsonValue>('host.builtinToolDefinitionEnvironment'),
            ),
      );
      this.hostToolDefinitionsLoaded = true;
    }

    this.mcp.ensureToolingCacheInBackground();
    this.refreshMergedToolDefinitions();
  }

  toolDefinitionsJson(): JsonValue {
    return this.toolDefinitionsCache;
  }

  async parseCommand(message: string): Promise<JsonValue> {
    if (this.localHostService) {
      return this.unwrapHostToolRequest(await this.localHostService.parseCommand(message));
    }

    return this.unwrapHostToolRequest(await this.peer.call<JsonValue>('host.parseCommand', { message }));
  }

  async requestFromFunctionCall(name: string, argumentsJson: string): Promise<JsonValue> {
    const availableDefinitions = this.toolDefinitionsJson();
    assertFinishTaskToolAllowed(name, this.loopToolExposureEnabled, availableDefinitions);
    assertAgentModeAllowsHostTool(name, this.agentMode, availableDefinitions);
    try {
      const localMcpRequest = await this.mcp.requestFromFunctionCall(name, argumentsJson);
      if (localMcpRequest) {
        return localMcpRequest;
      }

      const lspRequest = requestFromGetDiagnosticsFunctionCall(name, argumentsJson);
      if (lspRequest) {
        return lspRequest;
      }

      if (this.localHostService) {
        return this.unwrapHostToolRequest(
          await this.localHostService.requestFromFunctionCall(name, argumentsJson),
        );
      }

      return this.unwrapHostToolRequest(
        await this.peer.call<JsonValue>('host.requestFromFunctionCall', { name, argumentsJson }),
      );
    } catch (error) {
      throw enrichUnknownToolError(
        error,
        name,
        toolNamesFromDefinitions(availableDefinitions),
      );
    }
  }

  async authorize(request: JsonValue): Promise<AuthorizationDecision<JsonValue>> {
    if (this.mcp.isToolRequest(request)) {
      await this.mcp.authorizeToolRequest(request);
      return { kind: 'allowed' };
    }

    if (isLspDiagnosticsToolRequest(request)) {
      return { kind: 'allowed' };
    }

    if (this.localHostService) {
      return this.localHostService.authorize(request);
    }

    return this.peer.call<AuthorizationDecision<JsonValue>>('host.authorize', {
      request: this.serializeRequest(request),
    });
  }

  async trust(target: JsonValue): Promise<void> {
    if (this.localHostService && typeof target === 'string') {
      await this.localHostService.trust(target);
      return;
    }

    await this.peer.call('host.trust', { target });
  }

  async execute(request: JsonValue): Promise<ToolExecutionOutput> {
    if (this.mcp.isToolRequest(request)) {
      return this.executeLocalMcpTool(request);
    }

    if (isLspDiagnosticsToolRequest(request)) {
      return this.executeLspDiagnosticsTool(request);
    }

    if (this.localHostService) {
      const output = normalizeToolExecutionOutput(await this.localHostService.execute(request));
      return appendLspDiagnosticsAfterWriteIfNeeded(this.lsp, request, output);
    }

    const output = normalizeToolExecutionOutput(
      await this.peer.call<ToolExecutionOutput | string>('host.execute', {
        request: this.serializeRequest(request),
      }),
    );
    return appendLspDiagnosticsAfterWriteIfNeeded(this.lsp, request, output);
  }

  attachRequestMetadata(request: JsonValue, metadata: ToolRequestExecutionMetadata): JsonValue {
    if (!isJsonObject(request)) {
      return request;
    }

    let target: JsonValue = request;
    if (this.localHostService?.attachRequestMetadata) {
      target = this.unwrapHostToolRequest(
        this.localHostService.attachRequestMetadata(request, metadata),
      );
    }

    if (!isJsonObject(target)) {
      return target;
    }

    const existing = this.requestMetadata.get(target) ?? this.requestMetadata.get(request) ?? {};
    this.requestMetadata.set(target, {
      ...existing,
      ...(typeof metadata.toolCallId === 'string' ? { toolCallId: metadata.toolCallId } : {}),
      ...(typeof metadata.toolName === 'string' ? { toolName: metadata.toolName } : {}),
      ...(typeof metadata.subagentSessionId === 'string'
        ? { subagentSessionId: metadata.subagentSessionId }
        : {}),
      ...(typeof metadata.subagentTitle === 'string'
        ? { subagentTitle: metadata.subagentTitle }
        : {}),
      ...(typeof metadata.userInitiated === 'boolean'
        ? { userInitiated: metadata.userInitiated }
        : {}),
    });
    return target;
  }

  async continueAfterQuestions(
    request: JsonValue,
    result: AskQuestionsResult,
  ): Promise<JsonValue | undefined> {
    if (!isExtensionToolRequest(request)) {
      return undefined;
    }

    request.questions_result = result as JsonValue;
    return request;
  }

  shouldExecuteInBackground(request: JsonValue): boolean {
    if (this.mcp.isToolRequest(request)) {
      return true;
    }

    if (isExtensionToolRequest(request)) {
      return request.execution_mode === 'background';
    }

    return this.resolveRequestMetadata(request)?.backgroundExecution ?? false;
  }

  backgroundStatusText(request: JsonValue): string | undefined {
    if (this.mcp.isToolRequest(request)) {
      return this.mcp.backgroundStatusText(request);
    }

    if (isExtensionToolRequest(request) && request.execution_mode === 'background') {
      return `扩展工具执行中: ${request.tool_name}`;
    }

    return this.resolveRequestMetadata(request)?.backgroundStatusText;
  }

  startMcpBackgroundRefresh(): void {
    this.mcp.startBackgroundRefreshInBackground(true);
    this.refreshMergedToolDefinitions();
  }

  mcpStatusSnapshot(): McpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  async addMcpServer(name: string, config: JsonValue): Promise<string> {
    const result = await this.peer.call<string>('host.addMcpServer', { name, config });
    this.mcp.startBackgroundRefreshInBackground(true);
    this.refreshMergedToolDefinitions();
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

  async listCachedMcpPrompts(name: string): Promise<JsonValue[]> {
    return this.mcp.listCachedPrompts(name);
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
        ...(typeof metadata.subagentSessionId === 'string'
          ? { subagentSessionId: metadata.subagentSessionId }
          : {}),
        ...(typeof metadata.subagentTitle === 'string'
          ? { subagentTitle: metadata.subagentTitle }
          : {}),
        ...(typeof metadata.userInitiated === 'boolean'
          ? { userInitiated: metadata.userInitiated }
          : {}),
      },
    };
  }

  private resolveRequestMetadata(request: JsonValue): HostToolRequestMetadata | undefined {
    if (!isJsonObject(request)) {
      return undefined;
    }

    return this.requestMetadata.get(request);
  }

  private async executeLocalMcpTool(request: McpToolRequest): Promise<ToolExecutionOutput> {
    const metadata = this.resolveRequestMetadata(request);

    try {
      const output = await this.mcp.executeToolRequest(request);
      this.peer.notify('host.localToolExecuted', {
        request,
        output,
        ...(metadata?.toolCallId === undefined ? {} : { toolCallId: metadata.toolCallId }),
        toolName: metadata?.toolName ?? 'mcp_tool',
        ...(metadata?.subagentSessionId === undefined
          ? {}
          : { subagentSessionId: metadata.subagentSessionId }),
        ...(metadata?.subagentTitle === undefined
          ? {}
          : { subagentTitle: metadata.subagentTitle }),
      });
      return createToolExecutionTextOutput(output);
    } catch (error) {
      const message = renderError(error);
      this.peer.notify('host.localToolFailed', {
        request,
        error: message,
        ...(metadata?.toolCallId === undefined ? {} : { toolCallId: metadata.toolCallId }),
        toolName: metadata?.toolName ?? 'mcp_tool',
        ...(metadata?.subagentSessionId === undefined
          ? {}
          : { subagentSessionId: metadata.subagentSessionId }),
        ...(metadata?.subagentTitle === undefined
          ? {}
          : { subagentTitle: metadata.subagentTitle }),
      });
      throw error;
    }
  }

  private refreshMergedToolDefinitions(): void {
    let hostDefinitions = this.imageGenerationAvailable
      ? this.hostToolDefinitionsCache
      : filterToolDefinitionByName(this.hostToolDefinitionsCache, 'generate_image');
    if (
      isOpenResponsesTransportConfig(this.transportConfigForToolDefinitions)
      && shouldUseApplyPatchFileTools(this.transportConfigForToolDefinitions, { agentMode: this.agentMode })
      && Array.isArray(hostDefinitions)
    ) {
      hostDefinitions = filterLegacyHostFileToolDefinitions(hostDefinitions);
    }
    const mergedHostDefinitions = filterHostToolDefinitionsForAgentMode(
      Array.isArray(hostDefinitions)
        ? [
            ...hostDefinitions,
            ...this.loopToolDefinitionsCache,
            ...this.planToolDefinitionsCache,
            ...this.todoToolDefinitionsCache,
          ]
        : [...this.loopToolDefinitionsCache, ...this.planToolDefinitionsCache, ...this.todoToolDefinitionsCache],
      this.agentMode,
    );
    this.toolDefinitionsCache = mergeToolDefinitions(
      mergedHostDefinitions,
      this.extensionToolDefinitionsCache,
      this.mcp.toolDefinitionsJson(),
      this.lsp?.enabled ? buildLspHostToolDefinitions() : [],
    );
  }

  private async executeLspDiagnosticsTool(
    request: import('../lsp/types.js').LspDiagnosticsToolRequest,
  ): Promise<ToolExecutionOutput> {
    if (!this.lsp?.enabled) {
      throw new Error('get_diagnostics is not available because typescript-language-server was not found on PATH');
    }
    const result = await this.lsp.getDiagnosticsForPath(request.path);
    return createToolExecutionTextOutput(result.formatted);
  }
}

function normalizeToolExecutionOutput(output: ToolExecutionOutput | string): ToolExecutionOutput {
  return typeof output === 'string' ? createToolExecutionTextOutput(output) : output;
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
    ...(typeof candidate.subagentSessionId === 'string'
      ? { subagentSessionId: candidate.subagentSessionId }
      : {}),
    ...(typeof candidate.subagentTitle === 'string'
      ? { subagentTitle: candidate.subagentTitle }
      : {}),
    ...(typeof candidate.userInitiated === 'boolean'
      ? { userInitiated: candidate.userInitiated }
      : {}),
  };
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeToolDefinitions(
  hostDefinitions: JsonValue,
  extensionDefinitions: JsonValue[],
  mcpDefinitions: JsonValue[],
  lspDefinitions: JsonValue[] = [],
): JsonValue {
  const merged = Array.isArray(hostDefinitions) ? [...hostDefinitions] : [];
  merged.push(...extensionDefinitions, ...mcpDefinitions, ...lspDefinitions);
  const seenNames = new Set<string>();

  return merged.filter((definition) => {
    const name = toolDefinitionName(definition);
    if (!name) {
      return true;
    }
    if (seenNames.has(name)) {
      return false;
    }
    seenNames.add(name);
    return true;
  });
}

function filterToolDefinitionByName(definitions: JsonValue, excludedName: string): JsonValue {
  if (!Array.isArray(definitions)) {
    return definitions;
  }
  return definitions.filter((definition) => toolDefinitionName(definition) !== excludedName);
}

function toolDefinitionName(value: JsonValue): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const candidateFunction = value.function ?? null;
  if (!isJsonObject(candidateFunction)) {
    return undefined;
  }

  return typeof candidateFunction.name === 'string' ? candidateFunction.name : undefined;
}

function isExtensionToolRequest(value: JsonValue): value is {
  name: 'extension_tool';
  tool_name: string;
  execution_mode?: string;
  questions_result?: JsonValue;
} {
  if (!isJsonObject(value)) {
    return false;
  }

  return value.name === 'extension_tool' && typeof value.tool_name === 'string';
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseBuiltinHostToolDefinitionEnvironment(
  value: JsonValue,
): BuiltinHostToolDefinitionEnvironment {
  if (!isJsonObject(value)) {
    throw new Error('host.builtinToolDefinitionEnvironment 必须返回 JSON object');
  }

  const shellDisplayName =
    typeof value.shellDisplayName === 'string' && value.shellDisplayName.trim().length > 0
      ? value.shellDisplayName.trim()
      : 'the current shell';
  const shellCommandParameterDescription =
    typeof value.shellCommandParameterDescription === 'string' &&
    value.shellCommandParameterDescription.trim().length > 0
      ? value.shellCommandParameterDescription.trim()
      : 'The command to execute in the current shell. Do not assume Bash-only syntax unless the shell is POSIX compatible.';

  return {
    shellDisplayName,
    shellCommandParameterDescription,
  };
}