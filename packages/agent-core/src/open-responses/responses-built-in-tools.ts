import type { JsonObject, JsonValue, LlmStreamEvent } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import { ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES } from './alibaba-built-in-tools.js';

export const RESPONSES_BUILT_IN_TOOL_NAMES = [
  ...ALIBABA_RESPONSES_BUILT_IN_TOOL_TYPES,
] as const;

const OUTPUT_ITEM_TYPE_TO_TOOL_NAME: Record<string, (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number]> = {
  web_search_call: 'web_search',
  code_interpreter_call: 'code_interpreter',
};

/** Embedded in streaming-tool-preview argumentsJson for Desktop UI mapping. */
export const RESPONSES_BUILT_IN_SPIRIT_UI_KEY = '_spiritUi';

export type ResponsesBuiltInToolSpiritUi = {
  headlineDetail?: string;
  /** Set for completed web_search when action.sources is present (Bailian often omits real query text). */
  sourceCount?: number;
  inputExcerpt: string;
  outputExcerpt?: string;
  detailLines?: string[];
};

export type ResponsesBuiltInToolCardData = {
  status?: string;
  headlineDetail?: string;
  sourceCount?: number;
  inputExcerpt: string;
  outputExcerpt?: string;
  detailLines?: string[];
};

const HEADLINE_DETAIL_MAX = 80;

export function responsesBuiltInToolNameFromOutputItemType(
  outputItemType: string,
): (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number] | undefined {
  return OUTPUT_ITEM_TYPE_TO_TOOL_NAME[outputItemType];
}

export function isResponsesBuiltInToolName(toolName: string): boolean {
  return (RESPONSES_BUILT_IN_TOOL_NAMES as readonly string[]).includes(toolName);
}

export type ResponsesBuiltInToolStreamPhase = 'preview' | 'succeeded' | 'failed';

export function resolveResponsesBuiltInToolStreamPhase(
  item: JsonObject,
): ResponsesBuiltInToolStreamPhase {
  const status = typeof item.status === 'string' ? item.status.trim().toLowerCase() : '';
  if (
    status === 'completed' ||
    status === 'complete' ||
    status === 'succeeded' ||
    status === 'success'
  ) {
    return 'succeeded';
  }
  if (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'error' ||
    status === 'incomplete'
  ) {
    return 'failed';
  }
  return 'preview';
}

export function resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(
  argumentsJson: string,
): ResponsesBuiltInToolStreamPhase | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    return resolveResponsesBuiltInToolStreamPhase(parsed);
  } catch {
    return undefined;
  }
}

export function parseResponsesBuiltInToolUiFromArgumentsJson(
  argumentsJson: string,
): ResponsesBuiltInToolSpiritUi | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    const raw = parsed[RESPONSES_BUILT_IN_SPIRIT_UI_KEY];
    if (!isJsonObject(raw as JsonValue)) {
      return undefined;
    }
    const ui = raw as JsonObject;
    const inputExcerpt = typeof ui.inputExcerpt === 'string' ? ui.inputExcerpt : '';
    if (!inputExcerpt.trim()) {
      return undefined;
    }
    const headlineDetail =
      typeof ui.headlineDetail === 'string' && ui.headlineDetail.trim()
        ? ui.headlineDetail.trim()
        : undefined;
    const outputExcerpt =
      typeof ui.outputExcerpt === 'string' && ui.outputExcerpt.trim()
        ? ui.outputExcerpt
        : undefined;
    const detailLines = Array.isArray(ui.detailLines)
      ? ui.detailLines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
      : undefined;
    const sourceCount =
      typeof ui.sourceCount === 'number' && Number.isFinite(ui.sourceCount) && ui.sourceCount > 0
        ? Math.floor(ui.sourceCount)
        : undefined;
    return {
      ...(headlineDetail ? { headlineDetail } : {}),
      ...(sourceCount !== undefined ? { sourceCount } : {}),
      inputExcerpt,
      ...(outputExcerpt ? { outputExcerpt } : {}),
      ...(detailLines && detailLines.length > 0 ? { detailLines } : {}),
    };
  } catch {
    return undefined;
  }
}

export function buildResponsesBuiltInToolCardData(
  item: JsonObject,
  toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number],
): ResponsesBuiltInToolCardData {
  const status = readStringField(item, 'status');
  switch (toolName) {
    case 'web_search':
      return buildWebSearchCardData(item, status);
    case 'code_interpreter':
      return buildCodeInterpreterCardData(item, status);
    default:
      return {
        ...(status ? { status } : {}),
        inputExcerpt: JSON.stringify({ status }, null, 2),
      };
  }
}

function buildWebSearchCardData(
  item: JsonObject,
  status: string | undefined,
): ResponsesBuiltInToolCardData {
  const action = isJsonObject(item.action as JsonValue) ? (item.action as JsonObject) : undefined;
  const query =
    readStringField(action ?? {}, 'query')
    ?? readStringField(item, 'query')
    ?? readStringField(item, 'search_query');
  const sources = formatWebSearchSources(action);
  const streamPhase = resolveResponsesBuiltInToolStreamPhase(item);
  const inputPayload: JsonObject = {
    ...(query && !isGenericProviderWebSearchQuery(query) ? { query } : {}),
    ...(status ? { status } : {}),
    ...(action ? { action } : {}),
  };
  return {
    ...(status ? { status } : {}),
    inputExcerpt: JSON.stringify(inputPayload, null, 2),
    ...(sources.outputExcerpt ? { outputExcerpt: sources.outputExcerpt } : {}),
    ...(sources.detailLines.length > 0 ? { detailLines: sources.detailLines } : {}),
    ...(streamPhase === 'succeeded' && sources.sourceCount > 0
      ? { sourceCount: sources.sourceCount }
      : {}),
  };
}

/** Bailian Responses `web_search_call.action.query` is often the placeholder "Web search". */
export function isGenericProviderWebSearchQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized === 'web search' || normalized === 'websearch';
}

function buildCodeInterpreterCardData(
  item: JsonObject,
  status: string | undefined,
): ResponsesBuiltInToolCardData {
  const code = readStringField(item, 'code');
  const logs = formatCodeInterpreterLogs(item.outputs);
  const headlineDetail = code
    ? truncateHeadlineDetail(code.split(/\r?\n/u)[0] ?? code)
    : logs.lineCount > 0
      ? `${logs.lineCount} log line${logs.lineCount === 1 ? '' : 's'}`
      : undefined;
  const inputPayload: JsonObject = {
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
  };
  return {
    ...(status ? { status } : {}),
    ...(headlineDetail ? { headlineDetail } : {}),
    inputExcerpt: code ?? JSON.stringify(inputPayload, null, 2),
    ...(logs.text ? { outputExcerpt: logs.text } : {}),
  };
}

function formatWebSearchSources(action: JsonObject | undefined): {
  outputExcerpt?: string;
  detailLines: string[];
  sourceCount: number;
} {
  if (!action) {
    return { detailLines: [], sourceCount: 0 };
  }
  const sources = action.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    return { detailLines: [], sourceCount: 0 };
  }
  const detailLines: string[] = [];
  const outputLines: string[] = [];
  let index = 1;
  for (const entry of sources) {
    if (!isJsonObject(entry as JsonValue)) {
      continue;
    }
    const url = readStringField(entry as JsonObject, 'url');
    if (!url) {
      continue;
    }
    const line = `${index}. ${truncateHeadlineDetail(url, 512)}`;
    detailLines.push(line);
    outputLines.push(line);
    index += 1;
  }
  if (outputLines.length === 0) {
    return { detailLines: [], sourceCount: 0 };
  }
  return {
    outputExcerpt: outputLines.join('\n'),
    detailLines,
    sourceCount: detailLines.length,
  };
}

function formatCodeInterpreterLogs(outputs: JsonValue | undefined): {
  text: string;
  lineCount: number;
} {
  if (!Array.isArray(outputs)) {
    return { text: '', lineCount: 0 };
  }
  const parts: string[] = [];
  let lineCount = 0;
  for (const entry of outputs) {
    if (!isJsonObject(entry as JsonValue)) {
      continue;
    }
    const record = entry as JsonObject;
    if (typeof record.logs === 'string' && record.logs.trim()) {
      parts.push(record.logs);
      lineCount += record.logs.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
    }
  }
  return {
    text: parts.join('\n\n'),
    lineCount,
  };
}

export function buildResponsesBuiltInToolArgumentsJson(
  item: JsonObject,
  toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number],
): string {
  const payload: JsonObject = {};
  const query = readStringField(item, 'query');
  const url = readStringField(item, 'url');
  const queries = item.queries;
  if (query && !isGenericProviderWebSearchQuery(query)) {
    payload.query = query;
  }
  if (url) {
    payload.url = url;
  }
  if (Array.isArray(queries)) {
    payload.queries = queries;
  }
  if (isJsonObject(item.action as JsonValue)) {
    payload.action = item.action as JsonObject;
    const actionQuery = readStringField(item.action as JsonObject, 'query');
    if (actionQuery && !payload.query && !isGenericProviderWebSearchQuery(actionQuery)) {
      payload.query = actionQuery;
    }
  }
  if (Array.isArray(item.urls)) {
    payload.urls = item.urls;
  }
  const goal = readStringField(item, 'goal');
  if (goal) {
    payload.goal = goal;
  }
  const code = readStringField(item, 'code');
  if (code) {
    payload.code = code;
  }
  if (Array.isArray(item.outputs)) {
    payload.outputs = item.outputs;
  }
  if (typeof item.status === 'string') {
    payload.status = item.status;
  }

  const card = buildResponsesBuiltInToolCardData(item, toolName);
  const spiritUi: JsonObject = {
    inputExcerpt: card.inputExcerpt,
    ...(card.headlineDetail ? { headlineDetail: card.headlineDetail } : {}),
    ...(card.sourceCount ? { sourceCount: card.sourceCount } : {}),
    ...(card.outputExcerpt ? { outputExcerpt: card.outputExcerpt } : {}),
    ...(card.detailLines && card.detailLines.length > 0 ? { detailLines: card.detailLines } : {}),
  };
  payload[RESPONSES_BUILT_IN_SPIRIT_UI_KEY] = spiritUi;

  return JSON.stringify(payload);
}

/** Gateway AI SDK `tool-result` → Desktop builtin tool card (phase + _spiritUi output). */
export function buildGatewaySdkProviderBuiltinToolResultArgumentsJson(
  toolName: string,
  input: unknown,
  output: unknown,
  failed: boolean,
): string | undefined {
  if (!isResponsesBuiltInToolName(toolName)) {
    return undefined;
  }

  if (toolName === 'web_search') {
    const inputObj = isJsonObject(input as JsonValue) ? (input as JsonObject) : {};
    const query = readStringField(inputObj, 'query') ?? '';
    const sources: JsonObject[] = [];

    if (!failed && isJsonObject(output as JsonValue)) {
      const results = (output as JsonObject).results;
      if (Array.isArray(results)) {
        for (const result of results) {
          if (!isJsonObject(result as JsonValue)) {
            continue;
          }
          const entry = result as JsonObject;
          const url = readStringField(entry, 'url');
          if (!url) {
            continue;
          }
          const source: JsonObject = { type: 'url', url };
          const title = readStringField(entry, 'title');
          const snippet = readStringField(entry, 'snippet');
          if (title) {
            source.title = title;
          }
          if (snippet) {
            source.snippet = snippet;
          }
          sources.push(source);
        }
      }
    }

    const item: JsonObject = {
      type: 'web_search_call',
      status: failed ? 'failed' : 'completed',
      action: {
        type: 'search',
        query,
        sources,
      },
    };
    return buildResponsesBuiltInToolArgumentsJson(item, 'web_search');
  }

  return undefined;
}

function readStringField(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function truncateHeadlineDetail(value: string, max = HEADLINE_DETAIL_MAX): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

export type ResponsesBuiltInPreviewStreamState = {
  nextPreviewIndex: number;
  items: Map<
    string,
    {
      toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number];
      item: JsonObject;
    }
  >;
};

export function createResponsesBuiltInPreviewStreamState(
  nextPreviewIndex = 0,
): ResponsesBuiltInPreviewStreamState {
  return {
    nextPreviewIndex,
    items: new Map(),
  };
}

const RESPONSES_BUILT_IN_LIFECYCLE_CHUNK_TYPES: ReadonlyArray<{
  chunkType: string;
  toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number];
  status: string;
}> = [
  {
    chunkType: 'response.web_search_call.in_progress',
    toolName: 'web_search',
    status: 'in_progress',
  },
  {
    chunkType: 'response.web_search_call.searching',
    toolName: 'web_search',
    status: 'searching',
  },
  {
    chunkType: 'response.code_interpreter_call.in_progress',
    toolName: 'code_interpreter',
    status: 'in_progress',
  },
  {
    chunkType: 'response.code_interpreter_call.interpreting',
    toolName: 'code_interpreter',
    status: 'interpreting',
  },
];

function readResponsesBuiltInItemId(chunk: JsonObject): string | undefined {
  const itemId = readStringField(chunk, 'item_id');
  if (itemId) {
    return itemId;
  }
  if (isJsonObject(chunk.item as JsonValue)) {
    const item = chunk.item as JsonObject;
    return readStringField(item, 'id') ?? readStringField(item, 'call_id');
  }
  return undefined;
}

function responsesBuiltInOutputItemTypeForToolName(
  toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number],
): string {
  switch (toolName) {
    case 'web_search':
      return 'web_search_call';
    case 'code_interpreter':
      return 'code_interpreter_call';
    default:
      return toolName;
  }
}

function emitResponsesBuiltInToolPreview(
  item: JsonObject,
  toolName: (typeof RESPONSES_BUILT_IN_TOOL_NAMES)[number],
  state: ResponsesBuiltInPreviewStreamState,
): { events: LlmStreamEvent[]; state: ResponsesBuiltInPreviewStreamState } {
  const callId =
    readStringField(item, 'id')
    ?? readStringField(item, 'call_id')
    ?? `provider-${toolName}-${state.nextPreviewIndex}`;

  const mergedItem: JsonObject = {
    ...(state.items.get(callId)?.item ?? {}),
    ...item,
    id: callId,
    type: responsesBuiltInOutputItemTypeForToolName(toolName),
  };
  state.items.set(callId, { toolName, item: mergedItem });

  return {
    events: [
      {
        kind: 'streaming-tool-preview',
        toolCallId: callId,
        toolName,
        argumentsJson: buildResponsesBuiltInToolArgumentsJson(mergedItem, toolName),
      },
    ],
    state,
  };
}

function coerceResponsesBuiltInPreviewStreamState(
  stateOrIndex: ResponsesBuiltInPreviewStreamState | number,
): ResponsesBuiltInPreviewStreamState {
  if (typeof stateOrIndex === 'number') {
    return createResponsesBuiltInPreviewStreamState(stateOrIndex);
  }
  return stateOrIndex;
}

export function accumulateResponsesBuiltInToolPreviewsFromRawChunk(
  rawValue: unknown,
  stateOrIndex: ResponsesBuiltInPreviewStreamState | number = 0,
): {
  events: LlmStreamEvent[];
  state: ResponsesBuiltInPreviewStreamState;
  /** @deprecated Use `state.nextPreviewIndex`. */
  nextPreviewIndex: number;
} {
  const state = coerceResponsesBuiltInPreviewStreamState(stateOrIndex);

  if (!isJsonObject(rawValue as JsonValue) || typeof (rawValue as JsonObject).type !== 'string') {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  const chunk = rawValue as JsonObject;
  const chunkType = chunk.type;

  for (const lifecycle of RESPONSES_BUILT_IN_LIFECYCLE_CHUNK_TYPES) {
    if (chunkType !== lifecycle.chunkType) {
      continue;
    }
    const itemId = readResponsesBuiltInItemId(chunk);
    if (!itemId) {
      return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
    }
    const existing = state.items.get(itemId);
    const item: JsonObject = {
      ...(existing?.item ?? {}),
      id: itemId,
      type: responsesBuiltInOutputItemTypeForToolName(lifecycle.toolName),
      status: lifecycle.status,
    };
    const emitted = emitResponsesBuiltInToolPreview(item, lifecycle.toolName, state);
    return {
      events: emitted.events,
      state: emitted.state,
      nextPreviewIndex: emitted.state.nextPreviewIndex,
    };
  }

  if (chunkType !== 'response.output_item.added' && chunkType !== 'response.output_item.done') {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  if (!isJsonObject(chunk.item as JsonValue)) {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  const item = chunk.item as JsonObject;
  const itemType = typeof item.type === 'string' ? item.type : '';
  const toolName = responsesBuiltInToolNameFromOutputItemType(itemType);
  if (!toolName) {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  const emitted = emitResponsesBuiltInToolPreview(item, toolName, state);
  const finalizedState = {
    ...emitted.state,
    nextPreviewIndex:
      chunkType === 'response.output_item.added'
        ? emitted.state.nextPreviewIndex + 1
        : emitted.state.nextPreviewIndex,
  };

  return {
    events: emitted.events,
    state: finalizedState,
    nextPreviewIndex: finalizedState.nextPreviewIndex,
  };
}
