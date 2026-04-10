import type {
  AuthorizationDecision,
  AssistantAuxArchiveEntry,
  ChatArchive,
  JsonValue,
  LlmMessage,
  LlmTransport,
  ToolCallRequest,
  ToolExecutor,
} from './ports.js';

const TOOL_MEMORY_PREFIX = '[TOOL_MEMORY]';
const TOOL_MEMORY_RESULT_MAX_CHARS = 1200;
const TOOL_MEMORY_MAX_ENTRIES = 24;

export interface RuntimeToolExecution<ToolRequest> {
  toolCallId: string;
  toolName: string;
  request: ToolRequest;
  output: string;
  failed: boolean;
}

export interface RuntimeCompactionRecord {
  droppedMessages: number;
  beforeLength: number;
  afterLength: number;
  summary?: string;
}

export interface RuntimeStatePreparationResult<State> {
  state: State;
  changed: boolean;
}

export interface RuntimeHistoryPreparationResult {
  history: LlmMessage[];
  changed: boolean;
}

export type RuntimeEvent<ToolRequest> =
  | {
      kind: 'vision-fallback-retry';
      droppedImages: number;
      message: string;
    }
  | {
      kind: 'background-tool-status';
      phase: 'started' | 'finished';
      toolName: string;
      request: ToolRequest;
      statusText?: string;
      failed?: boolean;
    };

export interface RuntimePendingApproval<ToolRequest, TrustTarget> {
  prompt: string;
  request: ToolRequest;
  trustTarget?: TrustTarget;
  toolCallId?: string;
  toolName: string;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export type RuntimeApprovalDecision =
  | { kind: 'allow'; persistTrust?: boolean }
  | { kind: 'deny'; resultText?: string }
  | { kind: 'guidance'; userMessage: string; resultText?: string };

export type RuntimeTurnResult<State, ToolRequest, TrustTarget> =
  | {
      kind: 'completed';
      assistantText: string;
      state: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    }
  | {
      kind: 'failed';
      error: string;
      state?: State;
      requestTrace: JsonValue[];
      toolExecutions: RuntimeToolExecution<ToolRequest>[];
      compactions: RuntimeCompactionRecord[];
    };

export type RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget> =
  | {
      kind: 'completed';
      request: ToolRequest;
      toolName: string;
      output: string;
      failed: boolean;
      backgroundExecution: boolean;
    }
  | {
      kind: 'requires-approval';
      approval: RuntimePendingApproval<ToolRequest, TrustTarget>;
    }
  | {
      kind: 'denied';
      request: ToolRequest;
      toolName: string;
      message: string;
    }
  | {
      kind: 'submitted-user-turn';
      userMessage: string;
      result: RuntimeTurnResult<State, ToolRequest, TrustTarget>;
    }
  | {
      kind: 'failed';
      error: string;
      request?: ToolRequest;
    };

export interface AgentRuntimeOptions<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  config: Config;
  llmTransport: LlmTransport<Config, State>;
  toolExecutor: ToolExecutor<ToolRequest, TrustTarget>;
  createToolAgentState: (history: LlmMessage[], userInput: string) => State;
  appendToolResultMessage: (state: State, toolCallId: string, content: string) => State;
  appendUserMessage?: (state: State, content: string) => State;
  extractAssistantText: (state: State) => string | undefined;
  formatToolMemory?: (request: ToolRequest, output: string) => string | undefined;
  isVisionUnsupportedError?: (error: string) => boolean;
  truncateStateForContextRetry?: (state: State) => RuntimeStatePreparationResult<State>;
  truncateHistoryForCompaction?: (
    history: LlmMessage[],
  ) => RuntimeHistoryPreparationResult;
  rebuildRetryStateAfterCompaction?: (
    history: LlmMessage[],
    pendingUserInput: string,
    retryState: State,
  ) => State;
  maxAutoCompactRetries?: number;
  maxToolMemoryEntries?: number;
  onEvent?: (event: RuntimeEvent<ToolRequest>) => void;
}

interface RuntimeTurnContext<ToolRequest> {
  requestTrace: JsonValue[];
  toolExecutions: RuntimeToolExecution<ToolRequest>[];
  compactions: RuntimeCompactionRecord[];
  autoCompactAttempts: number;
}

interface PendingApprovalState<State, ToolRequest, TrustTarget> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
}

interface PendingManualApprovalState<ToolRequest, TrustTarget> {
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolName: string;
}

export class AgentRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  private readonly options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  private historyStore: LlmMessage[];
  private requestTraceStore: JsonValue[];
  private pendingBackgroundToolStatusStore: string | undefined;
  private pendingImagePathsStore: string[];
  private pendingMcpResourcesStore: PendingMcpResource[];
  private pendingUserTurnStore: string | undefined;
  private pendingApproval: PendingApprovalState<State, ToolRequest, TrustTarget> | undefined;
  private pendingManualApproval:
    | PendingManualApprovalState<ToolRequest, TrustTarget>
    | undefined;

  constructor(
    options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
    initialHistory: LlmMessage[] = [],
  ) {
    this.options = options;
    this.historyStore = cloneHistory(initialHistory);
    this.requestTraceStore = [];
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
  }

  history(): readonly LlmMessage[] {
    return this.historyStore;
  }

  requestTrace(): readonly JsonValue[] {
    return this.requestTraceStore;
  }

  pendingUserTurn(): string | undefined {
    return this.pendingUserTurnStore;
  }

  backgroundToolStatus(): string | undefined {
    return this.pendingBackgroundToolStatusStore;
  }

  pendingImagePaths(): readonly string[] {
    return this.pendingImagePathsStore;
  }

  pendingMcpResources(): readonly PendingMcpResource[] {
    return this.pendingMcpResourcesStore;
  }

  hasPendingApproval(): boolean {
    return this.pendingApproval !== undefined || this.pendingManualApproval !== undefined;
  }

  hasPendingManualApproval(): boolean {
    return this.pendingManualApproval !== undefined;
  }

  replaceHistory(history: LlmMessage[]): void {
    this.historyStore = cloneHistory(history);
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
  }

  replaceFromArchive(archive: ChatArchive): void {
    this.historyStore = archive.llmHistory.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      content: message.content,
      imagePaths: [...message.imagePaths],
    }));
    this.requestTraceStore = [];
    this.pendingBackgroundToolStatusStore = undefined;
    this.pendingImagePathsStore = [];
    this.pendingMcpResourcesStore = [];
    this.pendingUserTurnStore = undefined;
    this.pendingApproval = undefined;
    this.pendingManualApproval = undefined;
  }

  toArchive(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    assistantAux: AssistantAuxArchiveEntry[],
  ): ChatArchive {
    return {
      messages,
      assistantAux,
      llmHistory: this.historyStore.map((message) => ({
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      })),
    };
  }

  addPendingImage(path: string): void {
    this.pendingImagePathsStore.push(path);
  }

  clearPendingImages(): number {
    const cleared = this.pendingImagePathsStore.length;
    this.pendingImagePathsStore = [];
    return cleared;
  }

  async attachMcpResource(server: string, uri: string): Promise<string> {
    const value = await this.options.toolExecutor.readMcpResource(server, uri);
    const resource = pendingMcpResourceFromReadResult(server, server, uri, value);
    this.pendingMcpResourcesStore.push(resource);
    return shortLabelForPendingMcpResource(resource);
  }

  clearPendingMcpResources(): number {
    const cleared = this.pendingMcpResourcesStore.length;
    this.pendingMcpResourcesStore = [];
    return cleared;
  }

  recordContextMessage(role: 'system' | 'user' | 'assistant', content: string): void {
    this.historyStore.push({
      role,
      content,
      imagePaths: [],
    });
  }

  async applyMcpPrompt(
    server: string,
    prompt: string,
    argsJson?: string,
  ): Promise<{
    notice: string;
    result: RuntimeTurnResult<State, ToolRequest, TrustTarget>;
  }> {
    if (this.hasPendingApproval()) {
      throw new Error('请先响应当前待确认的工具调用。');
    }

    const value = await this.options.toolExecutor.getMcpPrompt(server, prompt, argsJson);
    const promptMessages = promptMessagesFromValue(value);
    if (promptMessages.length === 0) {
      throw new Error('MCP prompt 未返回可用 messages');
    }

    const userTurn =
      [...promptMessages]
        .reverse()
        .find((message) => message.role === 'user' && message.content.trim())?.content ??
      `请根据已应用的 MCP prompt ${prompt} 继续。`;

    this.historyStore.push(...promptMessages);
    this.pendingUserTurnStore = userTurn;
    const state = this.options.createToolAgentState(this.historyStore, userTurn);
    const result = await this.runTurnLoop(state, userTurn, createTurnContext<ToolRequest>());
    return {
      notice: `已应用 MCP prompt: ${server} / ${prompt}（${promptMessages.length} 条消息）`,
      result,
    };
  }

  async compactHistory(): Promise<RuntimeCompactionRecord> {
    if (this.options.truncateHistoryForCompaction) {
      const prepared = this.options.truncateHistoryForCompaction(this.historyStore);
      this.historyStore = cloneHistory(prepared.history);
    }

    const result = await this.options.llmTransport.compactHistoryManual(
      this.options.config,
      this.historyStore,
    );
    const summary = this.options.llmTransport.compactSummaryText(this.historyStore);
    return {
      droppedMessages: result.droppedMessages,
      beforeLength: result.beforeLength,
      afterLength: result.afterLength,
      ...(summary !== undefined ? { summary } : {}),
    };
  }

  async submitUserTurn(
    userInput: string,
    explicitImages: string[] = [],
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    if (this.hasPendingApproval()) {
      throw new Error('当前存在待确认的工具调用，请先处理审批。');
    }

    const images = explicitImages.length > 0 ? [...explicitImages] : this.takePendingImages();
    const resources = this.takePendingMcpResources();
    for (const resource of resources) {
      this.recordContextMessage('system', formatPendingMcpResourceContext(resource));
    }

    this.historyStore.push({
      role: 'user',
      content: userInput,
      imagePaths: images,
    });
    this.pendingUserTurnStore = userInput;

    const state = this.options.createToolAgentState(this.historyStore, userInput);
    return this.runTurnLoop(state, userInput, createTurnContext<ToolRequest>());
  }

  async resumePendingApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    const pending = this.pendingApproval;
    if (!pending) {
      throw new Error('当前没有待确认的工具调用。');
    }

    this.pendingApproval = undefined;

    if (decision.kind === 'allow') {
      if (decision.persistTrust && pending.trustTarget !== undefined) {
        await this.options.toolExecutor.trust(pending.trustTarget);
      }

      return this.executeAuthorizedToolCall(
        pending.pendingUserInput,
        pending.state,
        pending.request,
        pending.toolCallId,
        pending.toolName,
        pending.remainingCalls,
        pending.turn,
      );
    }

    if (decision.kind === 'guidance') {
      const guidanceText = decision.resultText?.trim()
        ? decision.resultText
        : '[denied by user] tool call rejected by user guidance';
      const guidanceMessage = decision.userMessage.trim();
      let resumedState = this.options.appendToolResultMessage(
        pending.state,
        pending.toolCallId,
        guidanceText,
      );

      if (!guidanceMessage) {
        return this.runTurnLoop(resumedState, pending.pendingUserInput, pending.turn);
      }

      this.historyStore.push({
        role: 'user',
        content: guidanceMessage,
        imagePaths: [],
      });
      this.pendingUserTurnStore = guidanceMessage;
      resumedState = this.options.appendUserMessage
        ? this.options.appendUserMessage(resumedState, guidanceMessage)
        : this.options.createToolAgentState(this.historyStore, guidanceMessage);

      return this.runTurnLoop(resumedState, guidanceMessage, pending.turn);
    }

    const deniedText = decision.resultText?.trim()
      ? decision.resultText
      : '[denied by user] tool call rejected by user approval policy';
    const resumedState = this.options.appendToolResultMessage(
      pending.state,
      pending.toolCallId,
      deniedText,
    );

    return this.processToolCalls(
      resumedState,
      pending.pendingUserInput,
      pending.remainingCalls,
      pending.turn,
    );
  }

  async executeManualToolCommand(
    message: string,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    let request: ToolRequest;
    try {
      request = await this.options.toolExecutor.parseCommand(message);
    } catch (error) {
      return {
        kind: 'failed',
        error: `工具命令解析失败: ${renderError(error)}`,
      };
    }

    const toolName = toolNameFromRequest(request);

    let authorization: AuthorizationDecision<TrustTarget>;
    try {
      authorization = await this.options.toolExecutor.authorize(request);
    } catch (error) {
      return {
        kind: 'failed',
        error: `工具权限检查失败: ${renderError(error)}`,
        request,
      };
    }

    if (authorization.kind === 'need-approval') {
      this.pendingManualApproval = {
        request,
        prompt: authorization.prompt,
        ...(authorization.trustTarget !== undefined
          ? { trustTarget: authorization.trustTarget }
          : {}),
        toolName,
      };
      return {
        kind: 'requires-approval',
        approval: {
          prompt: authorization.prompt,
          request,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolName,
        },
      };
    }

    return this.executeManualToolRequest(request, toolName);
  }

  async resumePendingManualToolApproval(
    decision: RuntimeApprovalDecision,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    const pending = this.pendingManualApproval;
    if (!pending) {
      throw new Error('当前没有待确认的手动工具调用。');
    }

    this.pendingManualApproval = undefined;

    if (decision.kind === 'allow') {
      if (decision.persistTrust && pending.trustTarget !== undefined) {
        await this.options.toolExecutor.trust(pending.trustTarget);
      }

      return this.executeManualToolRequest(pending.request, pending.toolName);
    }

    if (decision.kind === 'guidance') {
      const userMessage = decision.userMessage.trim();
      if (!userMessage) {
        return {
          kind: 'denied',
          request: pending.request,
          toolName: pending.toolName,
          message: '已拒绝本次工具调用。',
        };
      }

      const result = await this.submitUserTurn(userMessage);
      return {
        kind: 'submitted-user-turn',
        userMessage,
        result,
      };
    }

    return {
      kind: 'denied',
      request: pending.request,
      toolName: pending.toolName,
      message: '已拒绝本次工具调用。',
    };
  }

  private async runTurnLoop(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    let currentState = state;
    let emptyAssistantRetries = 0;

    while (true) {
      const completion = await this.options.llmTransport.startToolAgentRound(
        this.options.config,
        currentState,
        this.options.toolExecutor.toolDefinitionsJson(),
      );

      if (completion.kind === 'failure') {
        this.appendTrace(completion.requestTrace, turn);

        const textOnlyRetryState = this.tryFallbackToTextOnlyAndBuildRetryState(
          completion.error,
          pendingUserInput,
        );
        if (textOnlyRetryState !== undefined) {
          currentState = textOnlyRetryState;
          continue;
        }

        if (
          this.options.llmTransport.isContextOverflowError(completion.error) &&
          turn.autoCompactAttempts < (this.options.maxAutoCompactRetries ?? 1)
        ) {
          turn.autoCompactAttempts += 1;
          const preparedRetry = this.options.truncateStateForContextRetry
            ? this.options.truncateStateForContextRetry(currentState)
            : { state: currentState, changed: false };
          try {
            const compaction = await this.compactHistory();
            turn.compactions.push(compaction);

            if (compaction.droppedMessages === 0 && !preparedRetry.changed) {
              return {
                kind: 'failed',
                error: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${completion.error}`,
                state: preparedRetry.state,
                requestTrace: [...turn.requestTrace],
                toolExecutions: [...turn.toolExecutions],
                compactions: [...turn.compactions],
              };
            }

            currentState =
              compaction.droppedMessages === 0
                ? preparedRetry.state
                : this.options.rebuildRetryStateAfterCompaction
                  ? this.options.rebuildRetryStateAfterCompaction(
                      this.historyStore,
                      pendingUserInput,
                      preparedRetry.state,
                    )
                  : this.options.createToolAgentState(this.historyStore, pendingUserInput);
            continue;
          } catch (error) {
            return {
              kind: 'failed',
              error: `上下文压缩失败: ${renderError(error)} | 原始错误: ${completion.error}`,
              state: currentState,
              requestTrace: [...turn.requestTrace],
              toolExecutions: [...turn.toolExecutions],
              compactions: [...turn.compactions],
            };
          }
        }

        return {
          kind: 'failed',
          error: completion.error,
          state: currentState,
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        };
      }

      const round = completion.result;
      this.appendTrace(round.requestTrace, turn);
      currentState = round.state;

      if (round.step.kind === 'tool-calls') {
        return this.processToolCalls(
          currentState,
          pendingUserInput,
          round.step.calls,
          turn,
        );
      }

      const assistantText = this.options.extractAssistantText(currentState)?.trim();
      if (!assistantText) {
        emptyAssistantRetries += 1;
        if (emptyAssistantRetries > 1) {
          return {
            kind: 'failed',
            error: '模型返回了 final-response-ready，但没有可用的 assistant 正文。',
            state: currentState,
            requestTrace: [...turn.requestTrace],
            toolExecutions: [...turn.toolExecutions],
            compactions: [...turn.compactions],
          };
        }
        continue;
      }

      this.historyStore.push({
        role: 'assistant',
        content: assistantText,
        imagePaths: [],
      });
      this.pendingUserTurnStore = undefined;

      return {
        kind: 'completed',
        assistantText,
        state: currentState,
        requestTrace: [...turn.requestTrace],
        toolExecutions: [...turn.toolExecutions],
        compactions: [...turn.compactions],
      };
    }
  }

  private async processToolCalls(
    state: State,
    pendingUserInput: string,
    calls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    let currentState = state;
    const remaining = [...calls];

    while (remaining.length > 0) {
      const call = remaining.shift();
      if (!call) {
        break;
      }

      let request: ToolRequest;
      try {
        request = await this.options.toolExecutor.requestFromFunctionCall(
          call.name,
          call.argumentsJson,
        );
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[tool schema error] ${renderError(error)}`,
        );
        continue;
      }

      let authorization: AuthorizationDecision<TrustTarget>;
      try {
        authorization = await this.options.toolExecutor.authorize(request);
      } catch (error) {
        currentState = this.options.appendToolResultMessage(
          currentState,
          call.id,
          `[authorization error] ${renderError(error)}`,
        );
        continue;
      }

      if (authorization.kind === 'need-approval') {
        this.pendingApproval = {
          pendingUserInput,
          state: currentState,
          request,
          prompt: authorization.prompt,
          ...(authorization.trustTarget !== undefined
            ? { trustTarget: authorization.trustTarget }
            : {}),
          toolCallId: call.id,
          toolName: call.name,
          remainingCalls: remaining,
          turn,
        };

        return {
          kind: 'requires-approval',
          approval: {
            prompt: authorization.prompt,
            request,
            ...(authorization.trustTarget !== undefined
              ? { trustTarget: authorization.trustTarget }
              : {}),
            toolCallId: call.id,
            toolName: call.name,
          },
          requestTrace: [...turn.requestTrace],
          toolExecutions: [...turn.toolExecutions],
          compactions: [...turn.compactions],
        };
      }

      return this.executeAuthorizedToolCall(
        pendingUserInput,
        currentState,
        request,
        call.id,
        call.name,
        remaining,
        turn,
      );
    }

    return this.runTurnLoop(currentState, pendingUserInput, turn);
  }

  private async executeAuthorizedToolCall(
    pendingUserInput: string,
    state: State,
    request: ToolRequest,
    toolCallId: string,
    toolName: string,
    remainingCalls: ToolCallRequest[],
    turn: RuntimeTurnContext<ToolRequest>,
  ): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>> {
    const execution = await this.performToolExecution(request, toolName);

    turn.toolExecutions.push({
      toolCallId,
      toolName,
      request,
      output: execution.output,
      failed: execution.failed,
    });

    const resumedState = this.options.appendToolResultMessage(state, toolCallId, execution.output);
    if (remainingCalls.length > 0) {
      return this.processToolCalls(resumedState, pendingUserInput, remainingCalls, turn);
    }

    return this.runTurnLoop(resumedState, pendingUserInput, turn);
  }

  private appendTrace(trace: JsonValue[], turn: RuntimeTurnContext<ToolRequest>): void {
    this.requestTraceStore.push(...trace);
    turn.requestTrace.push(...trace);
  }

  private tryFallbackToTextOnlyAndBuildRetryState(
    error: string,
    pendingUserInput: string,
  ): State | undefined {
    if (!this.options.isVisionUnsupportedError?.(error)) {
      return undefined;
    }

    let droppedImages = 0;
    let userTurn = this.pendingUserTurnStore ?? pendingUserInput;

    for (let index = this.historyStore.length - 1; index >= 0; index -= 1) {
      const message = this.historyStore[index];
      if (!message) {
        continue;
      }

      if (message.role !== 'user' || (message.imagePaths?.length ?? 0) === 0) {
        continue;
      }

      droppedImages = message.imagePaths?.length ?? 0;
      if (!userTurn.trim()) {
        userTurn = message.content;
      }
      message.imagePaths = [];
      break;
    }

    if (droppedImages === 0 || !userTurn.trim()) {
      return undefined;
    }

    this.pendingUserTurnStore = userTurn;
    const fallbackMessage = `当前模型/接口不支持图像输入，已自动降级为文本重试（忽略 ${droppedImages} 张图片）。`;
    this.emitEvent({
      kind: 'vision-fallback-retry',
      droppedImages,
      message: fallbackMessage,
    });

    return this.options.createToolAgentState(this.historyStore, userTurn);
  }

  private emitEvent(event: RuntimeEvent<ToolRequest>): void {
    this.options.onEvent?.(event);
  }

  private async executeManualToolRequest(
    request: ToolRequest,
    toolName: string,
  ): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
    const execution = await this.performToolExecution(request, toolName);
    return {
      kind: 'completed',
      request,
      toolName,
      output: execution.output,
      failed: execution.failed,
      backgroundExecution: execution.backgroundExecution,
    };
  }

  private async performToolExecution(
    request: ToolRequest,
    toolName: string,
  ): Promise<{
    output: string;
    failed: boolean;
    backgroundExecution: boolean;
  }> {
    let output: string;
    let failed = false;
    const backgroundExecution = this.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false;
    const backgroundStatusText = backgroundExecution
      ? this.options.toolExecutor.backgroundStatusText?.(request)
      : undefined;

    if (backgroundExecution) {
      this.pendingBackgroundToolStatusStore = backgroundStatusText;
      this.emitEvent({
        kind: 'background-tool-status',
        phase: 'started',
        toolName,
        request,
        ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
      });
    }

    try {
      output = await this.options.toolExecutor.execute(request);
    } catch (error) {
      failed = true;
      output = `[tool error] ${renderError(error)}`;
    } finally {
      if (backgroundExecution) {
        this.pendingBackgroundToolStatusStore = undefined;
        this.emitEvent({
          kind: 'background-tool-status',
          phase: 'finished',
          toolName,
          request,
          ...(backgroundStatusText !== undefined ? { statusText: backgroundStatusText } : {}),
          failed,
        });
      }
    }

    const toolMemory = (this.options.formatToolMemory ?? defaultToolMemoryFormatter)(
      request,
      output,
    );
    if (toolMemory?.trim()) {
      this.historyStore.push({
        role: 'system',
        content: toolMemory,
        imagePaths: [],
      });
      pruneToolMemories(
        this.historyStore,
        this.options.maxToolMemoryEntries ?? TOOL_MEMORY_MAX_ENTRIES,
      );
    }

    return {
      output,
      failed,
      backgroundExecution,
    };
  }

  private takePendingImages(): string[] {
    const images = [...this.pendingImagePathsStore];
    this.pendingImagePathsStore = [];
    return images;
  }

  private takePendingMcpResources(): PendingMcpResource[] {
    const resources = [...this.pendingMcpResourcesStore];
    this.pendingMcpResourcesStore = [];
    return resources;
  }
}

function createTurnContext<ToolRequest>(): RuntimeTurnContext<ToolRequest> {
  return {
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
    autoCompactAttempts: 0,
  };
}

function cloneHistory(history: LlmMessage[]): LlmMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
    imagePaths: [...(message.imagePaths ?? [])],
  }));
}

function pruneToolMemories(history: LlmMessage[], maxEntries: number): void {
  let seen = 0;
  const total = history.filter(
    (message) => message.role === 'system' && message.content.startsWith(TOOL_MEMORY_PREFIX),
  ).length;

  if (total <= maxEntries) {
    return;
  }

  const removeCount = total - maxEntries;
  const pruned = history.filter((message) => {
    if (message.role === 'system' && message.content.startsWith(TOOL_MEMORY_PREFIX)) {
      seen += 1;
      return seen > removeCount;
    }

    return true;
  });

  history.splice(0, history.length, ...pruned);
}

function defaultToolMemoryFormatter<ToolRequest>(
  request: ToolRequest,
  output: string,
): string {
  return [
    TOOL_MEMORY_PREFIX,
    `request: ${truncateForPreview(safeStringify(request), 600)}`,
    'result_snippet:',
    truncateForPreview(output, TOOL_MEMORY_RESULT_MAX_CHARS),
  ].join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateForPreview(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function pendingMcpResourceFromReadResult(
  server: string,
  displayName: string,
  requestedUri: string,
  value: JsonValue,
): PendingMcpResource {
  const contents = isJsonObject(value) && Array.isArray(value.contents) ? value.contents : undefined;
  if (!contents || contents.length === 0) {
    throw new Error(`MCP resource 返回为空: ${requestedUri}`);
  }

  const renderedSections: string[] = [];
  let mimeType: string | undefined;
  let finalUri = requestedUri;

  for (const content of contents) {
    if (!isJsonObject(content)) {
      renderedSections.push(safePrettyJson(content));
      continue;
    }

    if (typeof content.uri === 'string') {
      finalUri = content.uri;
    }
    if (mimeType === undefined && typeof content.mimeType === 'string') {
      mimeType = content.mimeType;
    }

    if (typeof content.text === 'string') {
      renderedSections.push(content.text);
      continue;
    }

    if (typeof content.blob === 'string') {
      renderedSections.push(`[blob base64 omitted, ${Array.from(content.blob).length} chars]`);
      continue;
    }

    renderedSections.push(safePrettyJson(content));
  }

  return {
    server,
    displayName,
    uri: finalUri,
    ...(mimeType !== undefined ? { mimeType } : {}),
    readAtUnixMs: Date.now(),
    content: renderedSections.join('\n\n---\n\n'),
  };
}

function shortLabelForPendingMcpResource(resource: PendingMcpResource): string {
  return `${resource.server} -> ${resource.uri}`;
}

function formatPendingMcpResourceContext(resource: PendingMcpResource): string {
  return [
    '[MCP_RESOURCE]',
    `server: ${resource.server}`,
    `display_name: ${resource.displayName}`,
    `uri: ${resource.uri}`,
    `mime_type: ${resource.mimeType ?? 'application/octet-stream'}`,
    `read_at_unix_ms: ${resource.readAtUnixMs}`,
    '',
    resource.content,
  ].join('\n');
}

function promptMessagesFromValue(value: JsonValue): LlmMessage[] {
  const messages = isJsonObject(value) && Array.isArray(value.messages) ? value.messages : undefined;
  if (!messages) {
    throw new Error('MCP prompt 返回格式异常：缺少 messages');
  }

  return messages.map((message) => {
    if (!isJsonObject(message)) {
      throw new Error('MCP prompt message 格式异常');
    }

    return {
      role: normalizePromptRole(typeof message.role === 'string' ? message.role : 'user'),
      content: promptContentToText(message.content),
      imagePaths: [],
    };
  });
}

function normalizePromptRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant') {
    return 'assistant';
  }
  if (role === 'system') {
    return 'system';
  }
  return 'user';
}

function promptContentToText(content: JsonValue | undefined): string {
  if (typeof content === 'string') {
    return content;
  }

  if (isJsonObject(content) && content.type === 'text') {
    return typeof content.text === 'string' ? content.text : '';
  }

  return safePrettyJson(content);
}

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolNameFromRequest(request: unknown): string {
  if (typeof request === 'object' && request !== null && 'name' in request) {
    const name = (request as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
  }

  return 'manual';
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}