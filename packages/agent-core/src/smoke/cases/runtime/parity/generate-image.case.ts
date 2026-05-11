import type {
  JsonValue,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutionOutput,
} from '../../../../ports.js';
import {
  DEFAULT_IMAGE_GENERATION_SIZE,
  createLlmMessageContentFromTextAndImages,
} from '../../../../ports.js';
import {
  AgentRuntime,
  HostExecutor,
  appendScriptedToolResult,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  historyAsPlainApiMessages,
  streamFromEvents,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from './harness.js';

const GENERATE_IMAGE_ASSISTANT_TEXT = 'GENERATE_IMAGE_OK';

export async function runGenerateImageCase(): Promise<RuntimeParityCaseResult> {
  const nonStreamingTransport = new GenerateImageTerminalTransport(
    'non-streaming',
    '{"prompt":"square poster of a quiet moonlit courtyard"}',
    'generate_image square poster',
  );
  const nonStreamingExecutor = new CountingHostExecutor();
  const nonStreamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const nonStreamingRuntime = createGenerateImageRuntime(
    nonStreamingTransport,
    nonStreamingExecutor,
    nonStreamingEvents,
    'square poster',
    DEFAULT_IMAGE_GENERATION_SIZE,
  );

  const nonStreamingResult = await nonStreamingRuntime.submitUserTurn('画一张正方形海报');
  if (
    nonStreamingResult.kind !== 'completed' ||
    nonStreamingResult.assistantText !== GENERATE_IMAGE_ASSISTANT_TEXT
  ) {
    throw new Error('generate_image 非流式 smoke 未完成。');
  }
  assertTerminalGenerateImageResult(
    nonStreamingResult.toolExecutions,
    nonStreamingTransport.rounds,
    nonStreamingExecutor.executedCalls,
    'generate_image 非流式 smoke',
  );
  assertToolResultMessagePersisted(
    nonStreamingResult.state,
    'generate_image 非流式 smoke',
  );

  const streamingTransport = new GenerateImageTerminalTransport(
    'streaming',
    '{"prompt":"wide poster of a quiet moonlit courtyard","size":"1536x1024"}',
    'generate_image wide poster',
  );
  const streamingExecutor = new CountingHostExecutor();
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingRuntime = createGenerateImageRuntime(
    streamingTransport,
    streamingExecutor,
    streamingEvents,
    'wide poster',
    '1536x1024',
  );

  await streamingRuntime.startUserTurnStreaming('画一张正方形海报');
  for (let index = 0; index < 24 && streamingRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingRuntime.poll();
  }
  if (streamingRuntime.isBusy()) {
    throw new Error('generate_image 流式 smoke 未在预期轮次内完成。');
  }

  const streamingResult = streamingRuntime.takeCompletedTurnResult();
  if (
    !streamingResult ||
    streamingResult.kind !== 'completed' ||
    streamingResult.assistantText !== GENERATE_IMAGE_ASSISTANT_TEXT
  ) {
    throw new Error('generate_image 流式 smoke 未完成。');
  }
  assertTerminalGenerateImageResult(
    streamingResult.toolExecutions,
    streamingTransport.rounds,
    streamingExecutor.executedCalls,
    'generate_image 流式 smoke',
  );
  assertToolResultMessagePersisted(
    streamingResult.state,
    'generate_image 流式 smoke',
  );
  return {
    generateImageNonStreamingResult: nonStreamingResult,
    generateImageStreamingEvents: streamingEvents,
  };
}

function createGenerateImageRuntime(
  transport: GenerateImageTerminalTransport,
  executor: CountingHostExecutor,
  events: RuntimeEvent<ScriptedToolRequest>[],
  expectedPromptSnippet: string,
  expectedSize: string,
): AgentRuntime<undefined, ScriptedState, ScriptedToolRequest> {
  return new AgentRuntime({
    config: undefined,
    llmTransport: transport,
    toolExecutor: executor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    extractAssistantText: extractScriptedAssistantText,
    generateImage: async (request): Promise<ToolExecutionOutput> => {
      if (!request.prompt.includes(expectedPromptSnippet)) {
        throw new Error('generate_image smoke 未收到模型重写后的最终 prompt。');
      }
      if (request.size !== expectedSize) {
        throw new Error(`generate_image smoke 未解析出预期 size：${request.size}`);
      }

      const markdownRef = 'spirit-image://generated/square-poster.png';
      const summaryText = [
        '[generated image]',
        `image_ref: ${markdownRef}`,
        `read_file_path: ${markdownRef}`,
        `embed_markdown: ![Generated image](${markdownRef})`,
      ].join('\n');

      return {
        content: createLlmMessageContentFromTextAndImages(summaryText, ['generated/square-poster.png']),
        summaryText,
      };
    },
    onEvent: (event) => events.push(event),
  });
}

function assertTerminalGenerateImageResult(
  toolExecutions: { toolName: string; failed: boolean; output: string; artifacts?: { path: string }[] }[],
  rounds: number,
  executedCalls: number,
  label: string,
): void {
  if (rounds !== 2) {
    throw new Error(`${label} 应在 generate_image 完成后继续到最终 assistant 轮次。`);
  }
  if (executedCalls !== 0) {
    throw new Error(`${label} 不应落到宿主 execute。`);
  }

  const execution = toolExecutions.find((item) => item.toolName === 'generate_image');
  if (!execution || execution.failed || !execution.output.includes('spirit-image://generated/square-poster.png')) {
    throw new Error(`${label} 未记录正确的 generate_image 工具结果。`);
  }
  if (execution.output.includes('path: generated/square-poster.png')) {
    throw new Error(`${label} 不应向模型暴露真实生成图片路径。`);
  }
  if (!execution.artifacts?.some((artifact) => artifact.path === 'generated/square-poster.png')) {
    throw new Error(`${label} 未把生成图片路径放入 structured artifacts。`);
  }
}

function assertToolResultMessagePersisted(
  state: ScriptedState,
  label: string,
): void {
  const toolMessage = state.messages.find((message) => {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return false;
    }

    return message.role === 'tool' && message.tool_call_id === 'call-generate-image';
  }) as { content?: unknown } | undefined;

  if (
    typeof toolMessage?.content !== 'string' ||
    !toolMessage.content.includes('spirit-image://generated/square-poster.png')
  ) {
    throw new Error(`${label} 未把 generate_image 结果写回 runtime state messages。`);
  }
  if (toolMessage.content.includes('path: generated/square-poster.png')) {
    throw new Error(`${label} 不应把真实生成图片路径写回 runtime state messages。`);
  }
}

class GenerateImageTerminalTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  constructor(
    private readonly mode: 'non-streaming' | 'streaming',
    private readonly argumentsJson: string,
    private readonly previewLine: string,
  ) {}

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    if (this.mode !== 'non-streaming') {
      throw new Error('generate_image streaming smoke 应走 streaming transport。');
    }

    return this.nextRound(state);
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    if (this.mode !== 'streaming') {
      throw new Error('generate_image non-streaming smoke 不应走 streaming transport。');
    }

    this.rounds += 1;
    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([
          {
            kind: 'streaming-tool-preview',
            toolCallId: 'call-generate-image',
            toolName: 'generate_image',
            argumentsJson: this.argumentsJson,
            previewLine: this.previewLine,
          },
        ]),
        completion: Promise.resolve(this.buildToolCallRound(state)),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'GENERATE_IMAGE_' },
          { kind: 'assistant-chunk', text: 'OK' },
          { kind: 'done' },
        ]),
        completion: Promise.resolve(this.buildFinalResponseRound(state)),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: 'failure',
        error: 'generate_image completed but runtime continued into an unexpected streaming round.',
        requestTrace: [{ mode: 'generate-image-terminal-extra-streaming-round' }],
      }),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }

  private async nextRound(state: ScriptedState): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;
    if (this.rounds === 1) {
      return this.buildToolCallRound(state);
    }

    if (this.rounds === 2) {
      return this.buildFinalResponseRound(state);
    }

    return {
      kind: 'failure',
      error: 'generate_image completed but runtime continued into another model round.',
      requestTrace: [{ mode: 'generate-image-terminal-extra-round' }],
    };
  }

  private buildToolCallRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: '准备生成图片。',
              tool_calls: [
                {
                  id: 'call-generate-image',
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: this.argumentsJson,
                  },
                },
              ],
            },
          ],
          steps: state.steps + 1,
        },
        step: {
          kind: 'tool-calls',
          calls: [
            {
              id: 'call-generate-image',
              name: 'generate_image',
              argumentsJson: this.argumentsJson,
            },
          ],
        },
        requestTrace: [{ mode: 'generate-image-terminal-round' }],
      },
    };
  }

  private buildFinalResponseRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [
            ...state.messages,
            { role: 'assistant', content: GENERATE_IMAGE_ASSISTANT_TEXT },
          ],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'generate-image-terminal-final-round' }],
      },
    };
  }
}

class CountingHostExecutor extends HostExecutor {
  executedCalls = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return super.execute(request);
  }
}
