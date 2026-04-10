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

export interface ChatArchive {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  assistantAux: AssistantAuxArchiveEntry[];
  llmHistory: Array<{ role: ChatRole; content: string; imagePaths: string[] }>;
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

export type AuthorizationDecision<TrustTarget = string> =
  | { kind: 'allowed' }
  | { kind: 'need-approval'; prompt: string; trustTarget?: TrustTarget };

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
  startMcpBackgroundRefresh(): void;
  mcpStatusSnapshot(): McpStatusSnapshot;
  addMcpServer(name: string, config: JsonValue): Promise<string>;
  listMcpServers(): Promise<McpServer[]>;
  inspectMcpServer(name: string): Promise<McpInspection>;
  listMcpTools(name: string): Promise<McpTool[]>;
  listMcpResources(name: string): Promise<McpResource[]>;
  readMcpResource(name: string, uri: string): Promise<JsonValue>;
  listMcpPrompts(name: string): Promise<McpPrompt[]>;
  getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<JsonValue>;
}

export interface LlmTransport<Config, State = JsonValue> {
  startToolAgentRound(
    config: Config,
    state: State,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<State>>;
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