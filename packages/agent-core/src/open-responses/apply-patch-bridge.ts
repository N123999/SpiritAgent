import { AsyncLocalStorage } from 'node:async_hooks';

import type { JsonObject, JsonValue, ToolCallRequest } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import {
  APPLY_PATCH_HOST_TOOL_NAME,
  type ApplyPatchOperation,
  buildApplyPatchFunctionToolDefinition,
  buildApplyPatchResponsesFunctionToolDefinition,
  hasApplyPatchToolInResponsesTools,
  isApplyPatchFunctionToolDefinition,
  shouldUseApplyPatchFileTools,
  shouldUseApplyPatchFunctionTool,
  shouldUseNativeApplyPatchRequestItems,
  shouldUseOpenAiSdkApplyPatchTool,
} from './apply-patch-eligibility.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';
import {
  buildWebSearchResponsesTraceToolEntry,
  shouldUseProviderWebSearch,
} from './web-search-eligibility.js';

export const APPLY_PATCH_NATIVE_TOOL = { type: 'apply_patch' } as const;

interface ApplyPatchRequestRound {
  callId: string;
  operation: JsonObject;
  outputStatus: 'completed' | 'failed';
  outputText?: string;
}

interface ApplyPatchBridgeStore {
  pendingApplyPatchCallIds: Set<string>;
  lastExtractedApplyPatchCalls: ToolCallRequest[];
  applyPatchRequestRounds: ApplyPatchRequestRound[];
  useNativeApplyPatchRequestItems: boolean;
}

const applyPatchBridgeStorage = new AsyncLocalStorage<ApplyPatchBridgeStore>();

function createApplyPatchBridgeStore(): ApplyPatchBridgeStore {
  return {
    pendingApplyPatchCallIds: new Set(),
    lastExtractedApplyPatchCalls: [],
    applyPatchRequestRounds: [],
    useNativeApplyPatchRequestItems: true,
  };
}

function currentApplyPatchBridgeStore(): ApplyPatchBridgeStore {
  return applyPatchBridgeStorage.getStore() ?? createApplyPatchBridgeStore();
}

/** Isolates apply_patch bridge state for one agent round (message bridge + fetch interceptor). */
export function runWithApplyPatchBridgeContext<T>(fn: () => T): T {
  return applyPatchBridgeStorage.run(createApplyPatchBridgeStore(), fn);
}

/** Keeps bridge state for a streaming round until {@link endApplyPatchBridgeRound}. */
export function beginApplyPatchBridgeRound(): void {
  applyPatchBridgeStorage.enterWith(createApplyPatchBridgeStore());
}

/** Clears round-scoped bridge state after a streaming round completes. */
export function endApplyPatchBridgeRound(): void {
  applyPatchBridgeStorage.enterWith(createApplyPatchBridgeStore());
}

/** Stash apply_patch rounds from OpenAI history; SDK messages must omit them (see message bridge). */
export function prepareApplyPatchRequestBodyStash(messages: readonly JsonValue[]): void {
  const store = currentApplyPatchBridgeStore();
  store.applyPatchRequestRounds = [];
  const pendingOperations = new Map<string, JsonObject>();

  for (const message of messages) {
    if (!isJsonObject(message as JsonValue)) {
      continue;
    }
    const record = message as JsonObject;

    if (record.role === 'assistant' && Array.isArray(record.tool_calls)) {
      for (const toolCall of record.tool_calls) {
        if (!isJsonObject(toolCall as JsonValue)) {
          continue;
        }
        const toolCallRecord = toolCall as JsonObject;
        if (!isJsonObject(toolCallRecord.function as JsonValue)) {
          continue;
        }
        const functionDef = toolCallRecord.function as JsonObject;
        if (functionDef.name !== APPLY_PATCH_HOST_TOOL_NAME) {
          continue;
        }
        const callId = typeof toolCallRecord.id === 'string' ? toolCallRecord.id : '';
        const operation = parseApplyPatchOperationFromArguments(functionDef.arguments);
        if (!callId || !operation) {
          continue;
        }
        pendingOperations.set(
          callId,
          cloneJsonValue(operation as unknown as JsonValue) as JsonObject,
        );
      }
      continue;
    }

    if (record.role !== 'tool') {
      continue;
    }

    const callId = typeof record.tool_call_id === 'string' ? record.tool_call_id : '';
    if (!callId || !pendingOperations.has(callId)) {
      continue;
    }

    const operation = pendingOperations.get(callId);
    if (!operation) {
      continue;
    }
    pendingOperations.delete(callId);

    const providerOutput = readApplyPatchToolResultProviderState(record);
    const content = typeof record.content === 'string' ? record.content : '';
    const failed =
      providerOutput?.status === 'failed'
      || content.includes('[tool')
      || content.toLowerCase().includes('error');

    store.applyPatchRequestRounds.push({
      callId,
      operation,
      outputStatus: failed ? 'failed' : 'completed',
      ...(failed && (providerOutput?.output ?? content)
        ? { outputText: providerOutput?.output ?? content }
        : {}),
    });
  }
}

export function clearApplyPatchRequestBodyStash(): void {
  currentApplyPatchBridgeStore().applyPatchRequestRounds = [];
}

export function takeLastExtractedApplyPatchCalls(): ToolCallRequest[] {
  const store = currentApplyPatchBridgeStore();
  const calls = store.lastExtractedApplyPatchCalls;
  store.lastExtractedApplyPatchCalls = [];
  return calls;
}

export function stashLastExtractedApplyPatchCalls(calls: readonly ToolCallRequest[]): void {
  currentApplyPatchBridgeStore().lastExtractedApplyPatchCalls = [...calls];
}

export function clearPendingApplyPatchCallIds(): void {
  currentApplyPatchBridgeStore().pendingApplyPatchCallIds.clear();
}

export function registerPendingApplyPatchCallIds(callIds: readonly string[]): void {
  const pending = currentApplyPatchBridgeStore().pendingApplyPatchCallIds;
  for (const callId of callIds) {
    if (callId.trim()) {
      pending.add(callId);
    }
  }
}

export function buildResponsesTraceTools(
  config: OpenResponsesTransportConfig,
  normalizedFunctionTools: readonly unknown[],
): JsonValue[] {
  const traceTools = normalizedFunctionTools.map((tool) => cloneJsonValue(tool as JsonValue));
  if (shouldUseApplyPatchFileTools(config)) {
    if (shouldUseOpenAiSdkApplyPatchTool(config)) {
      traceTools.push({
        type: 'provider_tool',
        id: 'openai.apply_patch',
        name: APPLY_PATCH_HOST_TOOL_NAME,
      });
    } else if (shouldUseApplyPatchFunctionTool(config)) {
      traceTools.push(cloneJsonValue(buildApplyPatchResponsesFunctionToolDefinition() as JsonValue));
    } else {
      traceTools.push(cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue));
    }
  }
  if (shouldUseProviderWebSearch(config)) {
    traceTools.push(cloneJsonValue(buildWebSearchResponsesTraceToolEntry() as JsonValue));
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
    if (patchItem.type === 'apply_patch_call') {
      const callId = typeof patchItem.call_id === 'string' ? patchItem.call_id : '';
      const operation = parseApplyPatchOperation(patchItem.operation);
      if (!callId || !operation) {
        continue;
      }

      calls.push({
        id: callId,
        name: APPLY_PATCH_HOST_TOOL_NAME,
        argumentsJson: buildApplyPatchToolCallArgumentsJson(callId, operation),
      });
      continue;
    }

    if (patchItem.type !== 'function_call' || patchItem.name !== APPLY_PATCH_HOST_TOOL_NAME) {
      continue;
    }

    const callId = typeof patchItem.call_id === 'string' ? patchItem.call_id : '';
    const operation = parseApplyPatchOperationFromArguments(patchItem.arguments);
    if (!callId || !operation) {
      continue;
    }

    calls.push({
      id: callId,
      name: APPLY_PATCH_HOST_TOOL_NAME,
      argumentsJson: buildApplyPatchToolCallArgumentsJson(callId, operation),
    });
  }

  return calls;
}

/** AI SDK Responses 校验 apply_patch 工具调用时需顶层 callId。 */
export function buildApplyPatchToolCallArgumentsJson(
  callId: string,
  operation: ApplyPatchOperation | JsonObject,
): string {
  return JSON.stringify({ callId, operation });
}

export function normalizeApplyPatchToolCallArgumentsJson(
  callId: string,
  argumentsJson: string,
): string {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed) || !isJsonObject(parsed.operation as JsonValue)) {
      return argumentsJson;
    }
    if (typeof parsed.callId === 'string' && parsed.callId === callId) {
      return argumentsJson;
    }
    return buildApplyPatchToolCallArgumentsJson(callId, parsed.operation as unknown as ApplyPatchOperation);
  } catch {
    return argumentsJson;
  }
}

export function appendApplyPatchToolCallsToAssistantMessage(
  message: JsonObject,
  calls: readonly ToolCallRequest[],
): void {
  const patchCalls = calls.filter((call) => call.name === APPLY_PATCH_HOST_TOOL_NAME);
  if (patchCalls.length === 0) {
    return;
  }

  const existing = Array.isArray(message.tool_calls)
    ? message.tool_calls.filter((entry) => isJsonObject(entry as JsonValue))
    : [];
  const nextCalls = patchCalls.map((call, index) => ({
    id: call.id,
    type: 'function',
    index: existing.length + index,
    function: {
      name: APPLY_PATCH_HOST_TOOL_NAME,
      arguments: normalizeApplyPatchToolCallArgumentsJson(call.id, call.argumentsJson),
    },
  }));

  message.tool_calls = [...existing, ...nextCalls];
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

export function patchResponsesRequestBodyForApplyPatch(
  body: JsonObject,
  config: OpenResponsesTransportConfig,
): void {
  const store = currentApplyPatchBridgeStore();
  store.useNativeApplyPatchRequestItems = shouldUseNativeApplyPatchRequestItems(config);

  const tools = body.tools;
  if (shouldUseApplyPatchFunctionTool(config)) {
    if (!hasApplyPatchToolInResponsesTools(tools)) {
      const definition = cloneJsonValue(buildApplyPatchResponsesFunctionToolDefinition() as JsonValue);
      if (Array.isArray(tools)) {
        tools.push(definition);
      } else {
        body.tools = [definition];
      }
    }
  } else if (Array.isArray(tools) && !tools.some((tool) => isApplyPatchNativeTool(tool))) {
    tools.push(cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue));
  } else if (!Array.isArray(tools)) {
    body.tools = [cloneJsonValue(APPLY_PATCH_NATIVE_TOOL as JsonValue)];
  }

  const input = body.input;
  if (!Array.isArray(input)) {
    return;
  }

  const applyPatchCallIds = new Set<string>();

  for (let index = 0; index < input.length; index += 1) {
    const rawItem = input[index];
    if (!isJsonObject(rawItem as JsonValue)) {
      continue;
    }
    const item = rawItem as JsonObject;
    if (item.type !== 'function_call' || item.name !== APPLY_PATCH_HOST_TOOL_NAME) {
      continue;
    }

    const callId = typeof item.call_id === 'string' ? item.call_id : '';
    const operation = parseApplyPatchOperationFromArguments(item.arguments);
    if (!callId || !operation) {
      continue;
    }

    if (store.useNativeApplyPatchRequestItems) {
      input[index] = {
        type: 'apply_patch_call',
        call_id: callId,
        operation: cloneJsonValue(operation as unknown as JsonValue) as JsonObject,
      };
    } else {
      item.arguments = buildApplyPatchToolCallArgumentsJson(callId, operation);
    }
    applyPatchCallIds.add(callId);
    store.pendingApplyPatchCallIds.add(callId);
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
    if (
      !callId
      || (!store.pendingApplyPatchCallIds.has(callId) && !applyPatchCallIds.has(callId))
    ) {
      continue;
    }

    if (!store.useNativeApplyPatchRequestItems) {
      store.pendingApplyPatchCallIds.delete(callId);
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
    store.pendingApplyPatchCallIds.delete(callId);
  }

  injectStashedApplyPatchRoundsIntoRequestInput(input, store);
}

function injectStashedApplyPatchRoundsIntoRequestInput(
  input: JsonValue[],
  store: ApplyPatchBridgeStore,
): void {
  if (store.applyPatchRequestRounds.length === 0) {
    return;
  }

  const stashedCallIds = new Set(store.applyPatchRequestRounds.map((round) => round.callId));

  for (let index = input.length - 1; index >= 0; index -= 1) {
    const rawItem = input[index];
    if (!isJsonObject(rawItem as JsonValue)) {
      continue;
    }
    const item = rawItem as JsonObject;
    const callId = typeof item.call_id === 'string' ? item.call_id : '';
    if (!callId || !stashedCallIds.has(callId)) {
      continue;
    }

    const type = item.type;
    if (
      (type === 'function_call' && item.name === APPLY_PATCH_HOST_TOOL_NAME)
      || type === 'function_call_output'
      || type === 'apply_patch_call'
      || type === 'apply_patch_call_output'
    ) {
      input.splice(index, 1);
    }
  }

  for (const round of store.applyPatchRequestRounds) {
    if (store.useNativeApplyPatchRequestItems) {
      input.push({
        type: 'apply_patch_call',
        call_id: round.callId,
        operation: round.operation,
      });
      input.push({
        type: 'apply_patch_call_output',
        call_id: round.callId,
        status: round.outputStatus,
        ...(round.outputText ? { output: round.outputText } : {}),
      });
    } else {
      input.push({
        type: 'function_call',
        call_id: round.callId,
        name: APPLY_PATCH_HOST_TOOL_NAME,
        arguments: buildApplyPatchToolCallArgumentsJson(
          round.callId,
          round.operation as unknown as ApplyPatchOperation,
        ),
      });
      input.push({
        type: 'function_call_output',
        call_id: round.callId,
        output: round.outputText ?? '',
      });
    }
    store.pendingApplyPatchCallIds.delete(round.callId);
  }
}

export function parseApplyPatchOperationFromArguments(
  argumentsValue: unknown,
): ApplyPatchOperation | undefined {
  let parsed: unknown = argumentsValue;
  if (typeof argumentsValue === 'string') {
    try {
      parsed = JSON.parse(argumentsValue) as JsonValue;
    } catch {
      return undefined;
    }
  }

  if (!isJsonObject(parsed as JsonValue)) {
    return undefined;
  }

  const record = parsed as JsonObject;
  if (isJsonObject(record.operation as JsonValue)) {
    return parseApplyPatchOperation(record.operation);
  }

  return parseApplyPatchOperation(record);
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
