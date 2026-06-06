import type {
  JsonValue,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutionOutput,
} from '../../../../ports.js';
import {
  DEFAULT_VIDEO_GENERATION_DURATION,
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

const GENERATE_VIDEO_ASSISTANT_TEXT = 'GENERATE_VIDEO_OK';

export async function runGenerateVideoCase(): Promise<RuntimeParityCaseResult> {
  const nonStreamingTransport = new GenerateVideoTerminalTransport(
    'non-streaming',
    '{"prompt":"cinematic clip of a quiet moonlit courtyard"}',
  );
  const nonStreamingExecutor = new CountingHostExecutor();
  const nonStreamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const nonStreamingRuntime = createGenerateVideoRuntime(
    nonStreamingTransport,
    nonStreamingExecutor,
    nonStreamingEvents,
    'cinematic clip',
    DEFAULT_VIDEO_GENERATION_DURATION,
  );

  const nonStreamingResult = await nonStreamingRuntime.submitUserTurn('生成一段视频');
  if (
    nonStreamingResult.kind !== 'completed' ||
    nonStreamingResult.assistantText !== GENERATE_VIDEO_ASSISTANT_TEXT
  ) {
    throw new Error('generate_video 非流式 smoke 未完成。');
  }
  assertTerminalGenerateVideoResult(
    nonStreamingResult.toolExecutions,
    nonStreamingTransport.rounds,
    nonStreamingExecutor.executedCalls,
    'generate_video 非流式 smoke',
  );

  const streamingTransport = new GenerateVideoTerminalTransport(
    'streaming',
    '{"prompt":"wide cinematic clip of a quiet moonlit courtyard","duration":8,"aspect_ratio":"16:9","resolution":"720p"}',
  );
  const streamingExecutor = new CountingHostExecutor();
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingRuntime = createGenerateVideoRuntime(
    streamingTransport,
    streamingExecutor,
    streamingEvents,
    'wide cinematic clip',
    8,
    '16:9',
    '720p',
  );

  await streamingRuntime.startUserTurnStreaming('生成一段视频');
  for (let index = 0; index < 24 && streamingRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingRuntime.poll();
  }
  if (streamingRuntime.isBusy()) {
    throw new Error('generate_video 流式 smoke 未在预期轮次内完成。');
  }

  const streamingResult = streamingRuntime.takeCompletedTurnResult();
  if (
    !streamingResult ||
    streamingResult.kind !== 'completed' ||
    streamingResult.assistantText !== GENERATE_VIDEO_ASSISTANT_TEXT
  ) {
    throw new Error('generate_video 流式 smoke 未完成。');
  }
  assertTerminalGenerateVideoResult(
    streamingResult.toolExecutions,
    streamingTransport.rounds,
    streamingExecutor.executedCalls,
    'generate_video 流式 smoke',
  );

  return {
    generateVideoNonStreamingResult: nonStreamingResult,
    generateVideoStreamingEvents: streamingEvents,
  };
}

function createGenerateVideoRuntime(
  transport: GenerateVideoTerminalTransport,
  executor: CountingHostExecutor,
  events: RuntimeEvent<ScriptedToolRequest>[],
  expectedPromptSnippet: string,
  expectedDuration: number,
  expectedAspectRatio?: string,
  expectedResolution?: string,
): AgentRuntime<undefined, ScriptedState, ScriptedToolRequest> {
  return new AgentRuntime({
    config: undefined,
    llmTransport: transport,
    toolExecutor: executor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    extractAssistantText: extractScriptedAssistantText,
    generateVideo: async (request): Promise<ToolExecutionOutput> => {
      if (!request.prompt.includes(expectedPromptSnippet)) {
        throw new Error('generate_video smoke 未收到模型重写后的最终 prompt。');
      }
      if (request.duration !== expectedDuration) {
        throw new Error(`generate_video smoke 未解析出预期 duration：${request.duration}`);
      }
      if (expectedAspectRatio && request.aspectRatio !== expectedAspectRatio) {
        throw new Error(`generate_video smoke 未解析出预期 aspect_ratio：${request.aspectRatio}`);
      }
      if (expectedResolution && request.resolution !== expectedResolution) {
        throw new Error(`generate_video smoke 未解析出预期 resolution：${request.resolution}`);
      }

      const markdownRef = 'spirit-agent://generated/video/courtyard-clip.mp4';
      const summaryText = [
        '[generated video]',
        `video_ref: ${markdownRef}`,
        `read_file_path: ${markdownRef}`,
        `embed_markdown: <video src="${markdownRef}" controls></video>`,
      ].join('\n');

      return {
        content: createLlmMessageContentFromTextAndImages(summaryText, [], ['generated/courtyard-clip.mp4']),
        summaryText,
      };
    },
    onEvent: (event) => events.push(event),
  });
}

function assertTerminalGenerateVideoResult(
  toolExecutions: { toolName: string; failed: boolean; output: string; artifacts?: { path: string }[] }[],
  rounds: number,
  executedCalls: number,
  label: string,
): void {
  if (rounds !== 2) {
    throw new Error(`${label} 应在 generate_video 完成后继续到最终 assistant 轮次。`);
  }
  if (executedCalls !== 0) {
    throw new Error(`${label} 不应落到宿主 execute。`);
  }

  const execution = toolExecutions.find((item) => item.toolName === 'generate_video');
  if (!execution || execution.failed || !execution.output.includes('spirit-agent://generated/video/courtyard-clip.mp4')) {
    throw new Error(`${label} 未记录正确的 generate_video 工具结果。`);
  }
  if (!execution.artifacts?.some((artifact) => artifact.path === 'generated/courtyard-clip.mp4')) {
    throw new Error(`${label} 未把生成视频路径放入 structured artifacts。`);
  }
}

class GenerateVideoTerminalTransport implements LlmTransport<undefined, ScriptedState> {
  rounds = 0;

  constructor(
    private readonly mode: 'non-streaming' | 'streaming',
    private readonly argumentsJson: string,
  ) {}

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    if (this.mode !== 'non-streaming') {
      throw new Error('generate_video streaming smoke 应走 streaming transport。');
    }

    return this.nextRound(state);
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    if (this.mode !== 'streaming') {
      throw new Error('generate_video non-streaming smoke 不应走 streaming transport。');
    }

    this.rounds += 1;
    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([
          {
            kind: 'streaming-tool-preview',
            toolCallId: 'call-generate-video',
            toolName: 'generate_video',
            argumentsJson: this.argumentsJson,
          },
        ]),
        completion: Promise.resolve(this.buildToolCallRound(state)),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'GENERATE_VIDEO_' },
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
        error: 'generate_video completed but runtime continued into an unexpected streaming round.',
        requestTrace: [{ mode: 'generate-video-terminal-extra-streaming-round' }],
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
      error: 'generate_video completed but runtime continued into another model round.',
      requestTrace: [{ mode: 'generate-video-terminal-extra-round' }],
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
              content: '准备生成视频。',
              tool_calls: [
                {
                  id: 'call-generate-video',
                  type: 'function',
                  function: {
                    name: 'generate_video',
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
              id: 'call-generate-video',
              name: 'generate_video',
              argumentsJson: this.argumentsJson,
            },
          ],
        },
        requestTrace: [{ mode: 'generate-video-terminal-round' }],
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
            { role: 'assistant', content: GENERATE_VIDEO_ASSISTANT_TEXT },
          ],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'generate-video-terminal-final-round' }],
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
