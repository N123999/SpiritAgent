import type { TextStreamPart } from 'ai';

import type { JsonObject, JsonValue, LlmStreamEvent, ToolAgentRoundCompletion } from '../ports.js';
import { APPLY_PATCH_HOST_TOOL_NAME } from './apply-patch-eligibility.js';
import {
  buildApplyPatchToolCallArgumentsJson,
  normalizeApplyPatchToolCallArgumentsJson,
  parseApplyPatchOperationFromArguments,
  registerPendingApplyPatchCallIds,
} from './apply-patch-bridge.js';
import { resolveStreamingToolPreviewEmit } from '../tool-streaming-preview-gate.js';
import { cloneJsonValue, isJsonObject, type ToolAgentState } from '../tool-agent.js';
import { attachResponseIdToAssistantMessage } from './provider-state.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';
import { renderResponsesTransportError } from './ai-sdk-message-bridge.js';
import {
  accumulateResponsesProviderBuiltinToolPreviewsFromRawChunk,
  createResponsesProviderBuiltinPreviewStreamState,
} from './responses-provider-builtin-tools.js';

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  streamItemId?: string;
  type: 'function';
  functionName: string;
  functionArguments: string;
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export async function* responsesEventStreamToRuntimeEvents(
  config: OpenResponsesTransportConfig,
  stream: AsyncIterable<TextStreamPart<any>>,
  nextState: ToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<ToolAgentState>>,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<number, AggregatedStreamingToolCall>();
  let assistantContent = '';
  let reasoningContent = '';
  let sawAnswerOrToolOutput = false;
  let nextToolIndex = 0;
  let providerPreviewState = createResponsesProviderBuiltinPreviewStreamState();
  let responseId: string | undefined;

  try {
    for await (const part of stream) {
      switch (part.type) {
        case 'reasoning-delta': {
          if (part.text) {
            reasoningContent += part.text;
            yield { kind: 'thinking-chunk', text: part.text };
          }
          break;
        }
        case 'text-delta': {
          sawAnswerOrToolOutput = true;
          assistantContent += part.text;
          yield { kind: 'assistant-chunk', text: part.text };
          break;
        }
        case 'tool-call': {
          // Parity with openai/ai-sdk-transport: tool calls are aggregated from raw
          // response.output_item.* chunks only. Also handling tool-call here duplicates
          // the same function_call when the SDK emits both raw and normalized parts.
          sawAnswerOrToolOutput = true;
          break;
        }
        case 'tool-input-delta': {
          sawAnswerOrToolOutput = true;
          const existing = [...toolCalls.values()].find((call) => call.id === part.id);
          if (existing) {
            existing.functionArguments += part.delta;
          }
          break;
        }
        case 'error': {
          throw part.error;
        }
        case 'raw': {
          const rawUpdates = accumulateOpenResponsesToolCallProgressFromRawChunk(
            toolCalls,
            part.rawValue,
            nextToolIndex,
          );
          if (rawUpdates.nextToolIndex !== nextToolIndex) {
            nextToolIndex = rawUpdates.nextToolIndex;
          }
          if (rawUpdates.events.length > 0) {
            sawAnswerOrToolOutput = true;
            for (const update of rawUpdates.events) {
              yield update;
            }
          }

          const providerPreviews = accumulateResponsesProviderBuiltinToolPreviewsFromRawChunk(
            part.rawValue,
            providerPreviewState,
          );
          providerPreviewState = providerPreviews.state;
          if (providerPreviews.events.length > 0) {
            sawAnswerOrToolOutput = true;
            for (const preview of providerPreviews.events) {
              yield preview;
            }
          }

          const rawResponseId = readResponseIdFromRawChunk(part.rawValue);
          if (rawResponseId) {
            responseId = rawResponseId;
          }

          const reasoningText = extractOpenResponsesReasoningTextFromRawChunk(part.rawValue);
          if (reasoningText) {
            reasoningContent += reasoningText;
            yield { kind: 'thinking-chunk', text: reasoningText };
          }
          break;
        }
        default:
          break;
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      throw new Error('流式 Responses 响应无任何 text / tool 输出。');
    }

    const assistantMessage = attachResponseIdToAssistantMessage(
      config,
      buildStreamingAssistantMessage(assistantContent, reasoningContent, toolCalls),
      responseId,
    );
    nextState.messages.push(assistantMessage);

    const calls = extractToolCallsFromAggregatedMap(toolCalls);
    const applyPatchCallIds = calls
      .filter((call) => call.name === APPLY_PATCH_HOST_TOOL_NAME)
      .map((call) => call.id);
    if (applyPatchCallIds.length > 0) {
      registerPendingApplyPatchCallIds(applyPatchCallIds);
    }
    completion.resolve({
      kind: 'success',
      result: {
        state: nextState,
        step: calls.length > 0 ? { kind: 'tool-calls', calls } : { kind: 'final-response-ready' },
        requestTrace,
      },
    });
    yield { kind: 'done' };
  } catch (error) {
    const rendered = renderResponsesTransportError(error);
    completion.resolve({
      kind: 'failure',
      error: rendered,
      requestTrace,
    });
    yield {
      kind: 'error',
      error: rendered,
    };
  }
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): JsonValue {
  const functionToolCalls = [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map((call) => ({
      index: call.index,
      id: call.id,
      type: call.type,
      function: {
        name: call.functionName,
        arguments:
          call.functionName === APPLY_PATCH_HOST_TOOL_NAME
            ? normalizeApplyPatchToolCallArgumentsJson(call.id, call.functionArguments)
            : call.functionArguments,
      },
    }));

  const message: JsonValue = {
    role: 'assistant',
    content: assistantContent || null,
    ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
  };

  if (reasoningContent.length > 0) {
    return { ...(message as JsonObject), reasoning_content: reasoningContent };
  }

  if (functionToolCalls.length > 0) {
    return { ...(message as JsonObject), reasoning_content: '' };
  }

  return message;
}

function extractToolCallsFromAggregatedMap(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
) {
  return [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .filter((call) => call.functionName.trim().length > 0)
    .map((call) => ({
      id: call.id,
      name: call.functionName,
      argumentsJson: call.functionArguments,
    }));
}

function accumulateOpenResponsesToolCallProgressFromRawChunk(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  rawValue: unknown,
  nextToolIndex: number,
): { events: LlmStreamEvent[]; nextToolIndex: number } {
  if (!isJsonObject(rawValue as JsonValue) || typeof (rawValue as JsonObject).type !== 'string') {
    return { events: [], nextToolIndex };
  }

  const chunk = asJsonObject(rawValue);
  if (!chunk || typeof chunk.type !== 'string') {
    return { events: [], nextToolIndex };
  }

  const events: LlmStreamEvent[] = [];
  let toolIndex = nextToolIndex;

  if (
    chunk.type === 'response.output_item.added' &&
    isJsonObject(chunk.item) &&
    chunk.item.type === 'apply_patch_call'
  ) {
    const item = chunk.item;
    const index = toolIndex;
    toolIndex += 1;
    const callId = typeof item.call_id === 'string' ? item.call_id : `stream-apply-patch-${index}`;
    const parsedOperation = isJsonObject(item.operation as JsonValue)
      ? parseApplyPatchOperationFromArguments(item.operation)
      : undefined;
    toolCalls.set(index, {
      index,
      id: callId,
      ...(typeof item.id === 'string' ? { streamItemId: item.id } : {}),
      type: 'function',
      functionName: APPLY_PATCH_HOST_TOOL_NAME,
      functionArguments: parsedOperation
        ? buildApplyPatchToolCallArgumentsJson(callId, parsedOperation)
        : '{}',
      readyPreviewEmitted: false,
    });
  }

  if (
    chunk.type === 'response.output_item.added' &&
    isJsonObject(chunk.item) &&
    chunk.item.type === 'function_call'
  ) {
    const item = chunk.item;
    const index = toolIndex;
    toolIndex += 1;
    toolCalls.set(index, {
      index,
      id: typeof item.call_id === 'string' ? item.call_id : `stream-tool-call-${index}`,
      ...(typeof item.id === 'string' ? { streamItemId: item.id } : {}),
      type: 'function',
      functionName: typeof item.name === 'string' ? item.name : '',
      functionArguments: typeof item.arguments === 'string' ? item.arguments : '',
      readyPreviewEmitted: false,
    });
  }

  if (chunk.type === 'response.function_call_arguments.delta' && typeof chunk.item_id === 'string') {
    const existing = findToolCallByItemId(toolCalls, chunk.item_id);
    if (existing && typeof chunk.delta === 'string') {
      existing.functionArguments += chunk.delta;
      maybeEmitPreview(events, existing);
    }
  }

  if (
    chunk.type === 'response.output_item.done' &&
    isJsonObject(chunk.item) &&
    chunk.item.type === 'apply_patch_call'
  ) {
    const item = chunk.item;
    const existing = findToolCallByItemId(toolCalls, typeof item.id === 'string' ? item.id : '');
    const target =
      existing ??
      (() => {
        const index = toolIndex;
        toolIndex += 1;
        const created: AggregatedStreamingToolCall = {
          index,
          id: typeof item.call_id === 'string' ? item.call_id : `stream-apply-patch-${index}`,
          type: 'function',
          functionName: APPLY_PATCH_HOST_TOOL_NAME,
          functionArguments: '{}',
          readyPreviewEmitted: false,
        };
        toolCalls.set(index, created);
        return created;
      })();

    if (typeof item.call_id === 'string') {
      target.id = item.call_id;
    }
    const parsedOperation = isJsonObject(item.operation as JsonValue)
      ? parseApplyPatchOperationFromArguments(item.operation)
      : undefined;
    if (parsedOperation) {
      target.functionArguments = buildApplyPatchToolCallArgumentsJson(target.id, parsedOperation);
    }
    maybeEmitPreview(events, target);
  }

  if (
    chunk.type === 'response.output_item.done' &&
    isJsonObject(chunk.item) &&
    chunk.item.type === 'function_call'
  ) {
    const item = chunk.item;
    const existing = findToolCallByItemId(toolCalls, typeof item.id === 'string' ? item.id : '');
    const target =
      existing ??
      (() => {
        const index = toolIndex;
        toolIndex += 1;
        const created: AggregatedStreamingToolCall = {
          index,
          id: typeof item.call_id === 'string' ? item.call_id : `stream-tool-call-${index}`,
          type: 'function',
          functionName: typeof item.name === 'string' ? item.name : '',
          functionArguments: typeof item.arguments === 'string' ? item.arguments : '',
          readyPreviewEmitted: false,
        };
        toolCalls.set(index, created);
        return created;
      })();

    if (typeof item.call_id === 'string') {
      target.id = item.call_id;
    }
    if (typeof item.name === 'string') {
      target.functionName = item.name;
    }
    if (typeof item.arguments === 'string') {
      target.functionArguments = item.arguments;
    }
    maybeEmitPreview(events, target);
  }

  return { events, nextToolIndex: toolIndex };
}

function findToolCallByItemId(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  itemId: string,
): AggregatedStreamingToolCall | undefined {
  if (!itemId) {
    return [...toolCalls.values()].at(-1);
  }

  return (
    [...toolCalls.values()].find((call) => call.streamItemId === itemId || call.id === itemId) ??
    [...toolCalls.values()].at(-1)
  );
}

function maybeEmitPreview(events: LlmStreamEvent[], call: AggregatedStreamingToolCall): void {
  if (!call.functionName) {
    return;
  }

  const previewState = {
    readyPreviewEmitted: call.readyPreviewEmitted,
    ...(call.lastPreviewArgsLen === undefined ? {} : { lastPreviewArgsLen: call.lastPreviewArgsLen }),
    ...(call.lastPreviewDetailSignature === undefined
      ? {}
      : { lastPreviewDetailSignature: call.lastPreviewDetailSignature }),
  };
  const decision = resolveStreamingToolPreviewEmit(
    call.functionName,
    call.functionArguments,
    previewState,
  );
  if (!decision.emit) {
    return;
  }

  events.push({
    kind: 'streaming-tool-preview',
    toolCallId: call.id,
    toolName: call.functionName,
    argumentsJson: call.functionArguments,
  });
  call.readyPreviewEmitted = decision.nextState.readyPreviewEmitted;
  if (decision.nextState.lastPreviewArgsLen !== undefined) {
    call.lastPreviewArgsLen = decision.nextState.lastPreviewArgsLen;
  }
  if (decision.nextState.lastPreviewDetailSignature !== undefined) {
    call.lastPreviewDetailSignature = decision.nextState.lastPreviewDetailSignature;
  }
}

/** OpenAI / Open Responses SSE：reasoning text / summary deltas. */
export function extractOpenResponsesReasoningTextFromRawChunk(rawValue: unknown): string | undefined {
  const chunk = asJsonObject(rawValue);
  if (!chunk || typeof chunk.type !== 'string') {
    return undefined;
  }

  switch (chunk.type) {
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const delta = chunk.delta;
      return typeof delta === 'string' && delta.length > 0 ? delta : undefined;
    }
    default:
      return undefined;
  }
}

function readResponseIdFromRawChunk(rawValue: unknown): string | undefined {
  if (!isJsonObject(rawValue as JsonValue)) {
    return undefined;
  }

  const chunk = rawValue as JsonObject;
  if (chunk.type === 'response.completed' && isJsonObject(chunk.response)) {
    const id = chunk.response.id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  }

  return undefined;
}

function asJsonObject(rawValue: unknown): JsonObject | undefined {
  return isJsonObject(rawValue as JsonValue) ? (rawValue as JsonObject) : undefined;
}
