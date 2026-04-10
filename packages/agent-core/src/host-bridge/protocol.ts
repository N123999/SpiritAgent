import type {
  JsonValue,
  LlmMessage,
} from '../ports.js';
import type {
  PendingAssistantAux,
  PendingMcpResource,
  RuntimeApprovalDecision,
  RuntimeEvent,
  RuntimePendingApproval,
} from '../runtime.js';
import type { OpenAiTransportConfig } from '../openai/transport.js';

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
  history: LlmMessage[];
  requestTrace: JsonValue[];
  pendingUserTurn?: string;
  pendingImagePaths: string[];
  pendingMcpResources: PendingMcpResource[];
  pendingAuxState?: PendingAssistantAux;
  hasPendingApproval: boolean;
  hasPendingManualApproval: boolean;
  currentPendingApproval?: RuntimePendingApproval<JsonValue, JsonValue>;
  isBusy: boolean;
  backgroundToolStatus?: string;
}

export interface DrainEventsResult {
  events: RuntimeEvent<JsonValue>[];
  snapshot: BridgeRuntimeSnapshot;
}

export interface RuntimeInitParams {
  transportConfig: OpenAiTransportConfig;
  history?: LlmMessage[];
}

export interface RuntimeSubmitUserTurnParams {
  text: string;
  explicitImages?: string[];
}

export interface RuntimeReplaceConfigParams {
  transportConfig: OpenAiTransportConfig;
}

export interface RuntimeAddPendingImageParams {
  path: string;
}

export interface RuntimeAttachMcpResourceParams {
  server: string;
  uri: string;
}

export interface RuntimeApplyMcpPromptParams {
  server: string;
  prompt: string;
  argsJson?: string;
}

export interface RuntimeRespondToPendingApprovalParams {
  decision: RuntimeApprovalDecision;
}

export interface RuntimeStartManualToolCommandParams {
  message: string;
}