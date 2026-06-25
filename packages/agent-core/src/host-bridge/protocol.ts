import type {
  AskQuestionsResult,
  JsonValue,
  LlmMessage,
} from '../ports.js';
import type {
  PendingAssistantAux,
  PendingMcpResource,
  RuntimeApprovalDecision,
  RuntimeEvent,
  RuntimePendingApproval,
  RuntimePendingQuestions,
  RuntimeSubagentSessionSummary,
} from '../runtime.js';
import type {
  LlmActiveSkill,
  LlmEnabledRule,
  LlmEnabledSkillCatalogEntry,
  LlmPlanMetadata,
} from '../llm-tool-agent.js';
import type { LlmTransportConfig } from '../provider-config.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result: JsonValue;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse;

export type BridgeApprovalLevel = 'default' | 'full-approval';

export interface BridgeRuntimeSnapshot {
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  hasPendingApproval: boolean;
  hasPendingManualApproval: boolean;
  hasPendingQuestions: boolean;
  currentPendingApproval?: RuntimePendingApproval<JsonValue, JsonValue>;
  currentPendingQuestions?: RuntimePendingQuestions<JsonValue>;
  childSessions: RuntimeSubagentSessionSummary[];
  isBusy: boolean;
  loopEnabled: boolean;
  approvalLevel: BridgeApprovalLevel;
  backgroundToolStatus?: string;
}

export interface DrainEventsResult {
  /** Includes `tool-execution-output-chunk` while `shell` streams; CLI ignores, Desktop projects to UI. */
  events: RuntimeEvent<JsonValue>[];
  snapshot: BridgeRuntimeSnapshot;
}

export interface BridgeExportState {
  apiMessages: JsonValue[];
  requestTrace: JsonValue[];
  systemPrompts: JsonValue;
}

export interface RuntimeInitParams {
  transportConfig: LlmTransportConfig;
  history?: LlmMessage[];
  enabledRules?: LlmEnabledRule[];
  enabledSkillCatalog?: LlmEnabledSkillCatalogEntry[];
  planMetadata?: LlmPlanMetadata;
  extensionToolDefinitions?: JsonValue[];
  loopEnabled?: boolean;
  approvalLevel?: BridgeApprovalLevel;
  /** CLI: must be set before createRuntime so session todo tools are registered on the executor. */
  todoSessionKey?: string;
}

export interface RuntimeSetApprovalLevelParams {
  approvalLevel: BridgeApprovalLevel;
}

export interface RuntimeSetLlmHttpVersionParams {
  llmHttpVersion: 'http1.1' | 'http2';
}

export interface RuntimeSetLlmClientVersionParams {
  clientVersion: string;
}

export interface RuntimeSetLoopEnabledParams {
  enabled: boolean;
}

export interface RuntimeSubmitUserTurnParams {
  text: string;
  explicitImages?: string[];
}

export interface RuntimeExportArchiveParams {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  assistantAux: Array<{
    messageIndex: number;
    thinking?: string;
    compaction?: string;
    finishTaskNotice?: string;
  }>;
}

export interface RuntimeReplaceConfigParams {
  transportConfig: LlmTransportConfig;
}

export interface RuntimeReplacePlanMetadataParams {
  planMetadata: LlmPlanMetadata;
}

export interface RuntimeActivateSkillParams {
  skill: LlmActiveSkill;
}

export interface RuntimeAddPendingImageParams {
  path: string;
}

export interface RuntimeAttachMcpResourceParams {
  server: string;
  uri: string;
}

export interface RuntimeNamedMcpServerParams {
  name: string;
}

export interface RuntimeApplyMcpPromptParams {
  server: string;
  prompt: string;
  argsJson?: string;
  userMessage?: string;
}

export interface RuntimeRespondToPendingApprovalParams {
  decision: RuntimeApprovalDecision;
}

export interface RuntimeSubagentSessionParams {
  sessionId: string;
}

export interface RuntimeRespondToPendingQuestionsParams {
  result: AskQuestionsResult;
}

export interface RuntimeStartManualToolCommandParams {
  message: string;
}

export interface RuntimeStartManualMcpToolParams {
  server: string;
  tool: string;
  argsJson?: string;
}
