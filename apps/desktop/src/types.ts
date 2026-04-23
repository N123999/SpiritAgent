export interface BootstrapRequest {
  workspaceRoot?: string;
}

export interface UpdateConfigRequest {
  activeModel: string;
  apiBase: string;
  uiLocale?: string;
  apiKey?: string;
  /** 与 Rust `UpdateConfigRequest.windows_mica` 一致；缺省不修改已保存的 Mica 开关。 */
  windowsMica?: boolean;
}

/** 与 CLI `chat_store` 已保存的 `*.json` 文件一致。 */
export interface ActiveSessionSnapshot {
  filePath: string;
  displayName: string;
}

export interface SessionListItem {
  path: string;
  displayName: string;
  modifiedAtUnixMs: number;
}

export interface DesktopSnapshot {
  workspaceRoot: string;
  runtimeReady: boolean;
  runtimeError?: string;
  config: DesktopConfigSnapshot;
  rules: DiscoverySummary;
  skills: DiscoverySummary;
  plan: PlanSnapshot;
  mcpStatus: McpStatusSnapshot;
  conversation: ConversationSnapshot;
  /** 从磁盘打开的会话；未从文件打开时为 `undefined`（新会话/未保存）。 */
  activeSession?: ActiveSessionSnapshot;
}

export interface DesktopConfigSnapshot {
  models: ModelProfileSnapshot[];
  activeModel: string;
  uiLocale?: string;
  activeApiKeyConfigured: boolean;
  /** 桌面宿主在 Windows 上是否使用 Mica 风格；无字段时按 true 处理。 */
  windowsMica?: boolean;
}

export interface ModelProfileSnapshot {
  name: string;
  apiBase: string;
}

export interface DiscoverySummary {
  discovered: number;
  enabled: number;
}

export interface PlanSnapshot {
  path: string;
  exists: boolean;
}

export interface McpStatusSnapshot {
  revision: number;
  state: 'idle' | 'loading' | 'ready' | 'error';
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface ConversationSnapshot {
  messages: ConversationMessageSnapshot[];
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  pendingToolApproval?: PendingToolApprovalSnapshot;
  pendingQuestions?: PendingQuestionsSnapshot;
  isBusy: boolean;
}

export interface ConversationMessageSnapshot {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  tool?: ToolBlockSnapshot;
  aux?: MessageAuxSnapshot;
  pending: boolean;
}

export interface ToolBlockSnapshot {
  toolCallId?: string;
  toolName: string;
  phase: 'pending-approval' | 'running' | 'succeeded' | 'failed';
  headline: string;
  detailLines: string[];
  argsExcerpt?: string;
  outputExcerpt?: string;
}

export interface MessageAuxSnapshot {
  thinking?: string;
  compaction?: string;
}

export interface PendingToolApprovalSnapshot {
  toolName: string;
  prompt: string;
}

export interface PendingQuestionsSnapshot {
  toolCallId: string;
  toolName: string;
  request: AskQuestionsRequest;
}

export interface PendingAssistantAux {
  kind: 'thinking' | 'compressing';
  statusText: string;
  detailText?: string;
}

export interface PendingMcpResource {
  server: string;
  displayName: string;
  uri: string;
  mimeType?: string;
  readAtUnixMs: number;
  content: string;
}

export interface AskQuestionsRequest {
  title?: string;
  questions: AskQuestionsQuestionSpec[];
}

export interface AskQuestionsQuestionSpec {
  id: string;
  title: string;
  kind: 'single_select' | 'multi_select' | 'text';
  required: boolean;
  options: AskQuestionsOptionSpec[];
  allowCustomInput: boolean;
  customInputPlaceholder?: string;
  customInputLabel?: string;
}

export interface AskQuestionsOptionSpec {
  label: string;
  summary?: string;
}

export interface AskQuestionsAnswer {
  questionId: string;
  title: string;
  kind: 'single_select' | 'multi_select' | 'text';
  answered: boolean;
  selectedOptionIndexes?: number[];
  selectedOptionLabels?: string[];
  customInput?: string;
  text?: string;
}

export interface AskQuestionsResult {
  status: 'answered' | 'skipped';
  answers?: AskQuestionsAnswer[];
}