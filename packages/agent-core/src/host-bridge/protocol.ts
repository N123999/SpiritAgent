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
  OpenAiActiveSkill,
  OpenAiEnabledRule,
  OpenAiEnabledSkillCatalogEntry,
  OpenAiPlanMetadata,
  OpenAiTransportConfig,
} from '../openai/transport.js';

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
  backgroundToolStatus?: string;
}

export interface DrainEventsResult {
  events: RuntimeEvent<JsonValue>[];
  snapshot: BridgeRuntimeSnapshot;
}

export interface BridgeExportState {
  apiMessages: JsonValue[];
  requestTrace: JsonValue[];
  systemPrompts: JsonValue;
}

export interface RuntimeInitParams {
  transportConfig: OpenAiTransportConfig;
  history?: LlmMessage[];
  enabledRules?: OpenAiEnabledRule[];
  enabledSkillCatalog?: OpenAiEnabledSkillCatalogEntry[];
  planMetadata?: OpenAiPlanMetadata;
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
  }>;
}

export interface RuntimeReplaceConfigParams {
  transportConfig: OpenAiTransportConfig;
}

export interface RuntimeReplacePlanMetadataParams {
  planMetadata: OpenAiPlanMetadata;
}

export interface RuntimeActivateSkillParams {
  skill: OpenAiActiveSkill;
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
