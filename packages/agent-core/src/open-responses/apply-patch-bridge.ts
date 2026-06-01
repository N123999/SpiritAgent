import type { JsonObject, JsonValue, ToolCallRequest } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import {
  APPLY_PATCH_HOST_TOOL_NAME,
  type ApplyPatchOperation,
  shouldUseApplyPatchFileTools,
} from './apply-patch-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

export const APPLY_PATCH_NATIVE_TOOL = { type: 'apply_patch' } as const;

const pendingApplyPatchCallIds = new Set<string>();
let lastExtractedApplyPatchCalls: ToolCallRequest[] = [];

export function takeLastExtractedApplyPatchCalls(): ToolCallRequest[] {
  const calls = lastExtractedApplyPatchCalls;
  lastExtractedApplyPatchCalls = [];
  return calls;
}

export function stashLastExtractedApplyPatchCalls(calls: readonly ToolCallRequest[]): void {
  lastExtractedApplyPatchCalls = [...calls];
}

export function clearPendingApplyPatchCallIds(): void {
  pendingApplyPatchCallIds.clear();
}

export function registerPendingApplyPatchCallIds(callIds: readonly string[]): void {
  for (const callId of callIds) {
    if (callId.trim()) {
      pendingApplyPatchCallIds.add(callId);
    }
  }
}

export function buildResponsesTraceTools(
  config: OpenResponsesTransportConfig,
  normalizedFunctionTools: readonly unknown[],
): JsonValue[] {
  const traceTools = normalizedFunctionTools.map((tool) => cloneJsonValue(tool as JsonValue));
  if (shouldUseApplyPatchFileTools(config)) {
    traceTools.push(cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue));
  }
  return traceTools;
}

export function extractApplyPatchCallsFromResponsesBody(body: unknown): ToolCallRequest[] {
  if (!isJsonObject(body as JsonValue)) {
    return [];
  }

  const output = (body as JsonObject).output;
  if (!Array.isArray(output)) {
    return [];
  }

  const calls: ToolCallRequest[] = [];
  for (const item of output) {
    if (!isJsonObject(item as JsonValue)) {
      continue;
    }
    const patchItem = item as JsonObject;
    if (patchItem.type !== 'apply_patch_call') {
      continue;
    }

    const callId = typeof patchItem.call_id === 'string' ? patchItem.call_id : '';
    const operation = parseApplyPatchOperation(patchItem.operation);
    if (!callId || !operation) {
      continue;
    }

    calls.push({
      id: callId,
      name: APPLY_PATCH_HOST_TOOL_NAME,
      argumentsJson: JSON.stringify({ operation }),
    });
  }

  return calls;
}

export function stripApplyPatchCallsFromResponsesBody(body: JsonObject): void {
  const output = body.output;
  if (!Array.isArray(output)) {
    return;
  }

  body.output = output.filter((item) => {
    return !(isJsonObject(item as JsonValue) && (item as JsonObject).type === 'apply_patch_call');
  });
}

export function patchResponsesRequestBodyForApplyPatch(body: JsonObject): void {
  const tools = body.tools;
  if (Array.isArray(tools) && !tools.some((tool) => isApplyPatchNativeTool(tool))) {
    tools.push(cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue));
  } else if (!Array.isArray(tools)) {
    body.tools = [cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue)];
  }

  const input = body.input;
  if (!Array.isArray(input) || pendingApplyPatchCallIds.size === 0) {
    return;
  }

  for (let index = 0; index < input.length; index += 1) {
    const rawItem = input[index];
    if (!isJsonObject(rawItem as JsonValue)) {
      continue;
    }
    const item = rawItem as JsonObject;
    if (item.type !== 'function_call_output') {
      continue;
    }

    const callId = typeof item.call_id === 'string' ? item.call_id : '';
    if (!callId || !pendingApplyPatchCallIds.has(callId)) {
      continue;
    }

    const outputText = stringifyCallOutput(item.output as JsonValue | undefined);
    const failed = outputText.includes('[tool') || outputText.toLowerCase().includes('error');
    input[index] = {
      type: 'apply_patch_call_output',
      call_id: callId,
      status: failed ? 'failed' : 'completed',
      ...(failed && outputText ? { output: outputText } : {}),
    };
    pendingApplyPatchCallIds.delete(callId);
  }
}

export function buildApplyPatchToolResultProviderState(
  callId: string,
  status: 'completed' | 'failed',
  output?: string,
): JsonObject {
  return {
    openAiResponses: {
      applyPatchCallOutput: {
        call_id: callId,
        status,
        ...(output ? { output } : {}),
      },
    },
    openResponses: {
      applyPatchCallOutput: {
        call_id: callId,
        status,
        ...(output ? { output } : {}),
      },
    },
  };
}

export function readApplyPatchToolResultProviderState(
  message: JsonObject,
): { call_id: string; status: 'completed' | 'failed'; output?: string } | undefined {
  const providerState = message.providerState;
  if (!isJsonObject(providerState as JsonValue)) {
    return undefined;
  }

  const provider = providerState as JsonObject;
  const openAi = provider.openAiResponses;
  const openResponses = provider.openResponses;
  const candidate = isJsonObject(openAi as JsonValue)
    ? (openAi as JsonObject).applyPatchCallOutput
    : isJsonObject(openResponses as JsonValue)
      ? (openResponses as JsonObject).applyPatchCallOutput
      : undefined;

  if (!isJsonObject(candidate as JsonValue)) {
    return undefined;
  }

  const outputItem = candidate as JsonObject;
  const callId = typeof outputItem.call_id === 'string' ? outputItem.call_id : '';
  const status = outputItem.status === 'failed' ? 'failed' : 'completed';
  if (!callId) {
    return undefined;
  }

  return {
    call_id: callId,
    status,
    ...(typeof outputItem.output === 'string' ? { output: outputItem.output } : {}),
  };
}

export function mergeToolCallsWithApplyPatch(
  functionCalls: readonly ToolCallRequest[],
  applyPatchCalls: readonly ToolCallRequest[],
): ToolCallRequest[] {
  if (applyPatchCalls.length === 0) {
    return [...functionCalls];
  }
  return [...functionCalls, ...applyPatchCalls];
}

function parseApplyPatchOperation(value: unknown): ApplyPatchOperation | undefined {
  if (!isJsonObject(value as JsonValue)) {
    return undefined;
  }

  const operation = value as JsonObject;
  const type = operation.type;
  const path = operation.path;
  if (
    (type !== 'create_file' && type !== 'update_file' && type !== 'delete_file')
    || typeof path !== 'string'
  ) {
    return undefined;
  }

  return {
    type,
    path,
    ...(typeof operation.diff === 'string' ? { diff: operation.diff } : {}),
  };
}

function isApplyPatchNativeTool(tool: unknown): boolean {
  return isJsonObject(tool as JsonValue) && (tool as JsonObject).type === 'apply_patch';
}

function stringifyCallOutput(output: JsonValue | undefined): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output === undefined || output === null) {
    return '';
  }
  return JSON.stringify(output);
}
