import type {
  AskQuestionsRequest,
  JsonValue,
  LlmMessage,
  LlmStreamEvent,
  LlmTransport,
  SubagentSessionArchiveEntry,
  SubagentSessionStatus,
  ToolAgentRoundCompletion,
  ToolCallRequest,
  ToolExecutor,
} from '../ports.js';

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
      kind: 'begin-assistant-response';
    }
  | {
      kind: 'update-pending-assistant-thinking';
      text: string;
    }
  | {
      /** 清空 `thinkingTextStore` 前发出，宿主可固化为一条独立 UI 消息。 */
      kind: 'assistant-thinking-segment-finalized';
      text: string;
    }
  | {
      kind: 'update-pending-assistant-compaction';
      text: string;
    }
  | {
      kind: 'assistant-chunk';
      text: string;
    }
  | {
      kind: 'replace-pending-assistant';
      text: string;
    }
  | {
      kind: 'assistant-response-completed';
    }
  | {
      kind: 'remove-pending-assistant';
    }
  | {
      kind: 'history-compacted';
      droppedMessages: number;
      summaryPreview?: string;
    }
  | {
      kind: 'approval-requested';
      approval: RuntimePendingApproval<ToolRequest, unknown>;
    }
  | {
      kind: 'questions-requested';
      questions: RuntimePendingQuestions<ToolRequest>;
    }
  | {
      kind: 'tool-call-started';
      toolCallId: string;
      toolName: string;
      request: ToolRequest;
    }
  | {
      kind: 'approval-resolved';
      toolCallId: string;
      toolName: string;
      request: ToolRequest;
      decisionKind: RuntimeApprovalDecision['kind'];
    }
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
    }
  | {
      kind: 'streaming-tool-preview';
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
    }
  | {
      kind: 'tool-execution-finished';
      execution: RuntimeToolExecution<ToolRequest>;
    };

export interface RuntimePendingApproval<ToolRequest, TrustTarget> {
  prompt: string;
  request: ToolRequest;
  trustTarget?: TrustTarget;
  toolCallId?: string;
  toolName: string;
  subagentSessionId?: string;
  subagentTitle?: string;
}

export interface RuntimeSubagentSessionSummary {
  sessionId: string;
  parentToolCallId: string;
  title: string;
  status: SubagentSessionStatus;
  startedAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
  latestMessage?: string;
  finalOutput?: string;
  error?: string;
}

export interface RuntimeSubagentSessionArchiveEntry extends SubagentSessionArchiveEntry {
  summary: RuntimeSubagentSessionSummary;
}

export interface RuntimePendingQuestions<ToolRequest> {
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  questions: AskQuestionsRequest;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface PendingWorkspaceFile {
  path: string;
  totalChars: number;
  truncated: boolean;
  attachedAtUnixMs: number;
  content: string;
}

export type AssistantAuxKind = 'thinking' | 'compressing';

export interface PendingAssistantAux {
  kind: AssistantAuxKind;
  statusText: string;
  detailText?: string;
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
      kind: 'requires-questions';
      questions: RuntimePendingQuestions<ToolRequest>;
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

export interface RuntimeCompletedManualToolCommandResult<ToolRequest> {
  kind: 'completed';
  request: ToolRequest;
  toolName: string;
  output: string;
  failed: boolean;
  backgroundExecution: boolean;
}

export type RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
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

export type RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget> =
  | RuntimeCompletedManualToolCommandResult<ToolRequest>
  | {
      kind: 'started-background';
      request: ToolRequest;
      toolName: string;
      statusText?: string;
    }
  | {
      kind: 'started-user-turn';
      userMessage: string;
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
      kind: 'failed';
      error: string;
      request?: ToolRequest;
    };

export type RuntimeManualHistoryCompactionResult =
  | {
      kind: 'completed';
      result: RuntimeCompactionRecord;
    }
  | {
      kind: 'failed';
      error: string;
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
  resolveWorkspaceFilesFromInput?: (
    userInput: string,
  ) => Promise<PendingWorkspaceFile[]> | PendingWorkspaceFile[];
}

export interface RuntimeTurnContext<ToolRequest> {
  requestTrace: JsonValue[];
  toolExecutions: RuntimeToolExecution<ToolRequest>[];
  compactions: RuntimeCompactionRecord[];
  autoCompactAttempts: number;
}

export interface PendingApprovalState<State, ToolRequest, TrustTarget> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

export interface PendingQuestionsState<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  questions: AskQuestionsRequest;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
}

export interface PendingManualApprovalState<ToolRequest, TrustTarget> {
  request: ToolRequest;
  prompt: string;
  trustTarget?: TrustTarget;
  toolName: string;
}

export interface PendingStreamingRound<State, ToolRequest> {
  pendingUserInput: string;
  turn: RuntimeTurnContext<ToolRequest>;
  rawEvents: LlmStreamEvent[];
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  streamEnded: boolean;
  cancel: (() => void) | undefined;
}

export interface PendingToolAgentRound<State, ToolRequest> {
  pendingUserInput: string;
  state: State;
  turn: RuntimeTurnContext<ToolRequest>;
  completion: ToolAgentRoundCompletion<State> | undefined;
  completionHandled: boolean;
  emptyAssistantRetries: number;
}

export interface PendingToolCallBackgroundToolExecution<State, ToolRequest> {
  kind: 'tool-call';
  pendingUserInput: string;
  state: State;
  request: ToolRequest;
  toolCallId: string;
  toolName: string;
  remainingCalls: ToolCallRequest[];
  turn: RuntimeTurnContext<ToolRequest>;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  statusText: string | undefined;
  output: string | undefined;
  failed: boolean | undefined;
}

export interface PendingManualBackgroundToolExecution<ToolRequest> {
  kind: 'manual';
  request: ToolRequest;
  toolName: string;
  statusText: string | undefined;
  output: string | undefined;
  failed: boolean | undefined;
}

export type PendingBackgroundToolExecution<State, ToolRequest> =
  | PendingToolCallBackgroundToolExecution<State, ToolRequest>
  | PendingManualBackgroundToolExecution<ToolRequest>;

export interface PendingAutoHistoryCompaction<State, ToolRequest> {
  kind: 'auto-retry';
  pendingUserInput: string;
  retryState: State;
  turn: RuntimeTurnContext<ToolRequest>;
  originalError: string;
  toolTruncationApplied: boolean;
  resumeAsStreaming: boolean;
  streamingEmitBeginResponse: boolean;
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

export interface PendingManualHistoryCompaction {
  kind: 'manual';
  compactedHistory: LlmMessage[] | undefined;
  result: RuntimeCompactionRecord | undefined;
  failure: string | undefined;
}

export type PendingHistoryCompaction<State, ToolRequest> =
  | PendingAutoHistoryCompaction<State, ToolRequest>
  | PendingManualHistoryCompaction;
