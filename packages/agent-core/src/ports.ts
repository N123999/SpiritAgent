export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: ChatRole;
  content: string;
  imagePaths?: string[];
}

export interface AssistantAuxArchiveEntry {
  messageIndex: number;
  thinking?: string;
  compaction?: string;
}

export type SubagentSessionStatus = 'running' | 'completed' | 'failed' | 'blocked';

export interface SubagentSessionSummary {
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

export interface SubagentSessionArchiveEntry {
  summary: SubagentSessionSummary;
  llmHistory: Array<{ role: ChatRole; content: string; imagePaths: string[] }>;
}

export interface DreamScope {
  workspaceRoot: string;
  gitBranch: string;
}

export type DreamRecordStatus = 'active' | 'superseded' | 'deleted';

export interface DreamSourceSessionRef {
  path: string;
  displayName?: string;
  savedAtUnixMs?: number;
}

export interface DreamRecord {
  id: string;
  scope: DreamScope;
  title: string;
  summary: string;
  details?: string;
  tags?: string[];
  status: DreamRecordStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  expiresAtUnixMs: number;
  sourceSessions: DreamSourceSessionRef[];
}

export interface DreamQuery {
  scope: DreamScope;
  nowUnixMs?: number;
  includeExpired?: boolean;
  includeDeleted?: boolean;
}

export type DreamCollectorRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'backoff';

export type DreamCollectorDecision = 'created' | 'updated' | 'deleted' | 'unchanged' | 'skipped';

export interface DreamCollectorRun {
  runId: string;
  scope: DreamScope;
  sourceSession?: DreamSourceSessionRef;
  status: DreamCollectorRunStatus;
  decision?: DreamCollectorDecision;
  dreamIds?: string[];
  startedAtUnixMs: number;
  completedAtUnixMs?: number;
  backoffUntilUnixMs?: number;
  error?: string;
  logPath?: string;
}

export type DreamLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DreamLogEntry {
  timeUnixMs: number;
  level: DreamLogLevel;
  event: string;
  runId?: string;
  scope?: DreamScope;
  sourceSessionPath?: string;
  message?: string;
  data?: JsonObject;
}

export interface DreamSettings {
  enabled: boolean;
  collectorModel?: string;
  debugMode: boolean;
}

export interface ChatArchive {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  assistantAux: AssistantAuxArchiveEntry[];
  llmHistory: Array<{ role: ChatRole; content: string; imagePaths: string[] }>;
  subagentSessions?: SubagentSessionArchiveEntry[];
}

export type McpStatusState = 'idle' | 'loading' | 'ready' | 'error';

export interface McpStatusSnapshot {
  revision: number;
  state: McpStatusState;
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface AppPaths {
  workspaceRoot(): string;
  configFile(): string;
  chatsDir(): string;
  permissionsFile(): string;
  logFile(): string;
}

export interface Telemetry {
  logEvent(message: string): void;
  logJsonHttpBody(label: string, payload: JsonValue): void;
}

export interface ConfigStore<Config> {
  load(): Promise<Config>;
  save(config: Config): Promise<void>;
}

export interface SecretStore {
  loadGlobalApiKey(): Promise<string | undefined>;
  saveGlobalApiKey(apiKey: string): Promise<void>;
  removeGlobalApiKey(): Promise<void>;
  loadModelApiKey(modelName: string): Promise<string | undefined>;
  saveModelApiKey(modelName: string, apiKey: string): Promise<void>;
  removeModelApiKey(modelName: string): Promise<void>;
  hasModelApiKey(modelName: string): Promise<boolean>;
}

export interface ChatRepository {
  list(): Promise<string[]>;
  save(path: string | undefined, archive: ChatArchive): Promise<string>;
  load(path: string): Promise<ChatArchive>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ToolAgentStep =
  | { kind: 'tool-calls'; calls: ToolCallRequest[] }
  | { kind: 'final-response-ready' };

export interface ToolAgentRoundResult<State = JsonValue> {
  state: State;
  step: ToolAgentStep;
  requestTrace: JsonValue[];
}

export type ToolAgentRoundCompletion<State = JsonValue> =
  | { kind: 'success'; result: ToolAgentRoundResult<State> }
  | { kind: 'failure'; error: string; requestTrace: JsonValue[] };

export type LlmStreamEvent =
  | { kind: 'thinking-chunk'; text: string }
  | { kind: 'tool-progress'; text: string }
  | {
      kind: 'streaming-tool-preview';
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
      previewLine: string;
    }
  | { kind: 'assistant-chunk'; text: string }
  | {
      kind: 'history-compacted';
      newHistory: LlmMessage[];
      droppedMessages: number;
    }
  | { kind: 'done' }
  | { kind: 'error'; error: string };

export interface StartedToolAgentRound<State = JsonValue> {
  eventStream: AsyncIterable<LlmStreamEvent>;
  completion: Promise<ToolAgentRoundCompletion<State>>;
  cancel?: () => void;
}

export type AskQuestionsQuestionKind = 'single_select' | 'multi_select' | 'text';

export interface AskQuestionsOption {
  label: string;
  summary?: string;
}

export interface AskQuestionsQuestion {
  id: string;
  title: string;
  kind: AskQuestionsQuestionKind;
  required?: boolean;
  options?: AskQuestionsOption[];
  allowCustomInput?: boolean;
  customInputPlaceholder?: string;
  customInputLabel?: string;
}

export interface AskQuestionsRequest {
  title?: string;
  questions: AskQuestionsQuestion[];
}

export interface AskQuestionsAnswer {
  questionId: string;
  title: string;
  kind: AskQuestionsQuestionKind;
  answered: boolean;
  selectedOptionIndexes?: number[];
  selectedOptionLabels?: string[];
  customInput?: string;
  text?: string;
}

export type AskQuestionsResult =
  | { status: 'skipped' }
  | { status: 'answered'; answers: AskQuestionsAnswer[] };

export interface RunSubagentRequest {
  task: string;
  successCriteria?: string;
  contextSummary?: string;
  filesToInspect?: string[];
  expectedOutput?: string;
}

export type AuthorizationDecision<TrustTarget = string> =
  | { kind: 'allowed' }
  | { kind: 'need-approval'; prompt: string; trustTarget?: TrustTarget }
  | { kind: 'need-questions'; questions: AskQuestionsRequest };

export interface ToolRequestExecutionMetadata {
  toolCallId?: string;
  toolName?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
}

export interface ToolExecutor<
  ToolRequest = unknown,
  TrustTarget = string,
  McpServer = unknown,
  McpTool = unknown,
  McpResource = unknown,
  McpPrompt = unknown,
  McpInspection = unknown,
> {
  toolDefinitionsJson(): JsonValue;
  parseCommand(message: string): Promise<ToolRequest>;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision<TrustTarget>>;
  trust(target: TrustTarget): Promise<void>;
  execute(request: ToolRequest): Promise<string>;
  attachRequestMetadata?(request: ToolRequest, metadata: ToolRequestExecutionMetadata): ToolRequest;
  continueAfterQuestions?(request: ToolRequest, result: AskQuestionsResult): Promise<ToolRequest | undefined>;
  shouldExecuteInBackground?(request: ToolRequest): boolean;
  backgroundStatusText?(request: ToolRequest): string | undefined;
  startMcpBackgroundRefresh(): void;
  mcpStatusSnapshot(): McpStatusSnapshot;
  addMcpServer(name: string, config: JsonValue): Promise<string>;
  listMcpServers(): Promise<McpServer[]>;
  inspectMcpServer(name: string): Promise<McpInspection>;
  listMcpTools(name: string): Promise<McpTool[]>;
  listMcpResources(name: string): Promise<McpResource[]>;
  readMcpResource(name: string, uri: string): Promise<JsonValue>;
  listCachedMcpPrompts(name: string): Promise<McpPrompt[]>;
  listMcpPrompts(name: string): Promise<McpPrompt[]>;
  getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue>;
}

export interface LlmTransport<Config, State = JsonValue> {
  startToolAgentRound(
    config: Config,
    state: State,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<State>>;
  startToolAgentRoundStreaming?(
    config: Config,
    state: State,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<State>>;
  compactHistoryManual(
    config: Config,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
  ): Promise<{
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  }>;
  compactSummaryText(history: LlmMessage[]): string | undefined;
  isContextOverflowError(error: string): boolean;
  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[];
  llmSystemPromptsForExport(): JsonValue;
}
