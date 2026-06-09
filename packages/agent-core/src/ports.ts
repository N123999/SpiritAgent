export type SpiritAgentMode = 'agent' | 'plan' | 'ask' | 'debug';

export function normalizeSpiritAgentMode(input?: {
  agentMode?: unknown;
  planMode?: boolean;
}): SpiritAgentMode {
  if (input?.agentMode === 'agent' || input?.agentMode === 'plan' || input?.agentMode === 'ask' || input?.agentMode === 'debug') {
    return input.agentMode;
  }
  return input?.planMode === true ? 'plan' : 'agent';
}

export function readSpiritAgentModeFromTransportConfig(
  config: { spiritAgentMode?: SpiritAgentMode; planMode?: boolean } | undefined,
): SpiritAgentMode {
  if (config?.spiritAgentMode === 'agent' || config?.spiritAgentMode === 'plan' || config?.spiritAgentMode === 'ask' || config?.spiritAgentMode === 'debug') {
    return config.spiritAgentMode;
  }
  return config?.planMode === true ? 'plan' : 'agent';
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LlmTextContentPart extends JsonObject {
  type: 'text';
  text: string;
}

export interface LlmImageContentPart extends JsonObject {
  type: 'image';
  path: string;
}

export interface LlmVideoContentPart extends JsonObject {
  type: 'video';
  path: string;
}

export type LlmContentPart = LlmTextContentPart | LlmImageContentPart | LlmVideoContentPart;
export type LlmMessageContent = LlmContentPart[];

export interface LlmMessage {
  role: ChatRole;
  content: LlmMessageContent;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

export interface LegacyLlmMessageArchiveEntry {
  role: ChatRole;
  content: string;
  imagePaths?: string[];
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

export interface StoredLlmMessageArchiveEntry {
  role: ChatRole;
  content: LlmMessageContent;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
  providerState?: JsonObject;
}

function cloneLlmToolCalls(toolCalls: readonly LlmToolCall[]): LlmToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsJson: toolCall.argumentsJson,
  }));
}

export function cloneLlmProviderState(providerState: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(providerState).map(([key, value]) => [key, cloneJsonValue(value)]),
  );
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }
  if (typeof value === 'object' && value !== null) {
    return cloneLlmProviderState(value);
  }
  return value;
}

export interface ToolExecutionOutput {
  content: LlmMessageContent;
  summaryText: string;
  hostUi?: ToolExecutionHostUi;
}

export interface ToolExecutionHostUi {
  lspWriteDiagnostics?: import('./lsp/types.js').LspWriteDiagnosticsUi;
}

export const DEFAULT_IMAGE_GENERATION_SIZE = '1024x1024';
export const DEFAULT_VIDEO_GENERATION_DURATION = 5;

export interface ImageGenerationRequest {
  prompt: string;
  size: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
}

export interface GeneratedImageSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface GeneratedImageFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export interface GeneratedVideoSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface GeneratedVideoFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export function createToolExecutionTextOutput(text: string): ToolExecutionOutput {
  return {
    content: createLlmMessageContentFromText(text),
    summaryText: text,
  };
}

export function createLlmTextContentPart(text: string): LlmTextContentPart {
  return { type: 'text', text };
}

export function createLlmImageContentPart(path: string): LlmImageContentPart {
  return { type: 'image', path };
}

export function createLlmVideoContentPart(path: string): LlmVideoContentPart {
  return { type: 'video', path };
}

export function createLlmMessageContentFromText(text: string): LlmMessageContent {
  return text.length > 0 ? [createLlmTextContentPart(text)] : [];
}

export function createLlmMessageContentFromTextAndImages(
  text: string,
  imagePaths: readonly string[] = [],
  videoPaths: readonly string[] = [],
): LlmMessageContent {
  const content: LlmMessageContent = [];
  if (text.length > 0) {
    content.push(createLlmTextContentPart(text));
  }
  for (const imagePath of imagePaths) {
    content.push(createLlmImageContentPart(imagePath));
  }
  for (const videoPath of videoPaths) {
    content.push(createLlmVideoContentPart(videoPath));
  }
  return content;
}

export function cloneLlmMessageContent(content: readonly LlmContentPart[]): LlmMessageContent {
  return content.map((part) => {
    if (part.type === 'text') {
      return { type: 'text', text: part.text };
    }

    if (part.type === 'video') {
      return { type: 'video', path: part.path };
    }

    return { type: 'image', path: part.path };
  });
}

export function llmMessageTextContent(content: readonly LlmContentPart[]): string {
  return content
    .filter((part): part is LlmTextContentPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function llmMessageImagePaths(content: readonly LlmContentPart[]): string[] {
  return content
    .filter((part): part is LlmImageContentPart => part.type === 'image')
    .map((part) => part.path);
}

export function llmMessageHasImages(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === 'image');
}

export function llmMessageVideoPaths(content: readonly LlmContentPart[]): string[] {
  return content
    .filter((part): part is LlmVideoContentPart => part.type === 'video')
    .map((part) => part.path);
}

export function llmMessageHasVideos(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === 'video');
}

export function llmMessageHasMedia(content: readonly LlmContentPart[]): boolean {
  return llmMessageHasImages(content) || llmMessageHasVideos(content);
}

export function llmMessageHasText(content: readonly LlmContentPart[]): boolean {
  return content.some((part) => part.type === 'text' && part.text.trim().length > 0);
}

export function llmMessageContentWithoutImages(
  content: readonly LlmContentPart[],
): LlmMessageContent {
  return content
    .filter((part): part is LlmTextContentPart => part.type === 'text')
    .map((part) => ({ type: 'text', text: part.text }));
}

export function normalizeStoredLlmMessage(
  message: StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry,
): LlmMessage {
  const toolCallId =
    'toolCallId' in message && typeof message.toolCallId === 'string'
      ? message.toolCallId
      : 'tool_call_id' in message && typeof message.tool_call_id === 'string'
        ? message.tool_call_id
        : undefined;
  const toolCalls =
    'toolCalls' in message && Array.isArray(message.toolCalls)
      ? cloneLlmToolCalls(message.toolCalls)
      : 'tool_calls' in message && Array.isArray(message.tool_calls)
        ? cloneLlmToolCalls(message.tool_calls)
        : undefined;
  const providerState =
    'providerState' in message && typeof message.providerState === 'object' && message.providerState !== null
      ? cloneLlmProviderState(message.providerState)
      : 'provider_state' in message
          && typeof message.provider_state === 'object'
          && message.provider_state !== null
        ? cloneLlmProviderState(message.provider_state as JsonObject)
        : undefined;

  if (Array.isArray(message.content)) {
    return {
      role: message.role,
      content: cloneLlmMessageContent(message.content),
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      ...(toolCalls !== undefined ? { toolCalls } : {}),
      ...(providerState !== undefined ? { providerState } : {}),
    };
  }

  return {
    role: message.role,
    content: createLlmMessageContentFromTextAndImages(
      message.content,
      'imagePaths' in message ? message.imagePaths ?? [] : [],
    ),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(providerState !== undefined ? { providerState } : {}),
  };
}

export interface AssistantAuxArchiveEntry {
  messageIndex: number;
  thinking?: string;
  compaction?: string;
  finishTaskNotice?: string;
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
  llmHistory: Array<StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry>;
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
  llmHistory: Array<StoredLlmMessageArchiveEntry | LegacyLlmMessageArchiveEntry>;
  subagentSessions?: SubagentSessionArchiveEntry[];
  loopEnabled?: boolean;
  approvalLevel?: 'default' | 'full-approval';
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

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ToolAgentRoundResult<State = JsonValue> {
  state: State;
  step: ToolAgentStep;
  requestTrace: JsonValue[];
  usage?: LlmTokenUsage;
  /** Provider SDK executed built-in search in-stream but the answer step is not ready yet. */
  resumeStreamingAfterProviderSearch?: boolean;
}

export type ToolAgentRoundCompletion<State = JsonValue> =
  | { kind: 'success'; result: ToolAgentRoundResult<State> }
  | { kind: 'failure'; error: string; requestTrace: JsonValue[] };

export type LlmStreamEvent =
  | { kind: 'thinking-chunk'; text: string }
  | {
      kind: 'streaming-tool-preview';
      toolCallId: string;
      toolName: string;
      argumentsJson: string;
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
  userInitiated?: boolean;
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
  /** When Loop is off, omit finish_task from toolDefinitionsJson(). */
  setLoopToolExposure?(loopEnabled: boolean): void;
  setAgentModeToolExposure?(agentMode: SpiritAgentMode): void;
  /** @deprecated Use {@link setAgentModeToolExposure}. */
  setPlanModeToolExposure?(planMode: boolean): void;
  parseCommand(message: string): Promise<ToolRequest>;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<ToolRequest>;
  authorize(request: ToolRequest): Promise<AuthorizationDecision<TrustTarget>>;
  trust(target: TrustTarget): Promise<void>;
  execute(request: ToolRequest): Promise<ToolExecutionOutput>;
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
