import type { JsonObject, JsonValue, LlmStreamEvent } from '../ports.js';
import { isJsonObject } from '../tool-agent.js';
import { ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES } from './alibaba-native-tools.js';

export const RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES = [
  ...ALIBABA_RESPONSES_BUILTIN_TOOL_TYPES,
] as const;

const OUTPUT_ITEM_TYPE_TO_TOOL_NAME: Record<string, (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number]> = {
  web_search_call: 'web_search',
  web_extractor_call: 'web_extractor',
  code_interpreter_call: 'code_interpreter',
};

/** Embedded in streaming-tool-preview argumentsJson for Desktop UI mapping. */
export const RESPONSES_PROVIDER_BUILTIN_SPIRIT_UI_KEY = '_spiritUi';

export type ResponsesProviderBuiltinToolSpiritUi = {
  headlineDetail?: string;
  /** Set for completed web_search when action.sources is present (Bailian often omits real query text). */
  sourceCount?: number;
  inputExcerpt: string;
  outputExcerpt?: string;
  detailLines?: string[];
};

export type ResponsesProviderBuiltinToolCardData = {
  status?: string;
  headlineDetail?: string;
  sourceCount?: number;
  inputExcerpt: string;
  outputExcerpt?: string;
  detailLines?: string[];
};

const HEADLINE_DETAIL_MAX = 80;

export function responsesProviderBuiltinToolNameFromOutputItemType(
  outputItemType: string,
): (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number] | undefined {
  return OUTPUT_ITEM_TYPE_TO_TOOL_NAME[outputItemType];
}

export function isResponsesProviderBuiltinToolName(toolName: string): boolean {
  return (RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES as readonly string[]).includes(toolName);
}

export type ResponsesProviderBuiltinToolStreamPhase = 'preview' | 'succeeded' | 'failed';

export function resolveResponsesProviderBuiltinToolStreamPhase(
  item: JsonObject,
): ResponsesProviderBuiltinToolStreamPhase {
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

export function resolveResponsesProviderBuiltinToolStreamPhaseFromArgumentsJson(
  argumentsJson: string,
): ResponsesProviderBuiltinToolStreamPhase | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    return resolveResponsesProviderBuiltinToolStreamPhase(parsed);
  } catch {
    return undefined;
  }
}

export function parseProviderBuiltinToolUiFromArgumentsJson(
  argumentsJson: string,
): ResponsesProviderBuiltinToolSpiritUi | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }
    const raw = parsed[RESPONSES_PROVIDER_BUILTIN_SPIRIT_UI_KEY];
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

export function buildResponsesProviderBuiltinToolCardData(
  item: JsonObject,
  toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number],
): ResponsesProviderBuiltinToolCardData {
  const status = readStringField(item, 'status');
  switch (toolName) {
    case 'web_search':
      return buildWebSearchCardData(item, status);
    case 'web_extractor':
      return buildWebExtractorCardData(item, status);
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
): ResponsesProviderBuiltinToolCardData {
  const action = isJsonObject(item.action as JsonValue) ? (item.action as JsonObject) : undefined;
  const query =
    readStringField(action ?? {}, 'query')
    ?? readStringField(item, 'query')
    ?? readStringField(item, 'search_query');
  const sources = formatWebSearchSources(action);
  const streamPhase = resolveResponsesProviderBuiltinToolStreamPhase(item);
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

function buildWebExtractorCardData(
  item: JsonObject,
  status: string | undefined,
): ResponsesProviderBuiltinToolCardData {
  const urls = readStringArrayField(item, 'urls');
  const goal = readStringField(item, 'goal');
  const output = readStringField(item, 'output');
  const headlineDetail = urls[0]
    ? truncateHeadlineDetail(urls[0])
    : goal
      ? truncateHeadlineDetail(goal)
      : undefined;
  const inputPayload: JsonObject = {
    ...(urls.length > 0 ? { urls } : {}),
    ...(goal ? { goal } : {}),
    ...(status ? { status } : {}),
  };
  return {
    ...(status ? { status } : {}),
    ...(headlineDetail ? { headlineDetail } : {}),
    inputExcerpt: JSON.stringify(inputPayload, null, 2),
    ...(output ? { outputExcerpt: output } : {}),
  };
}

function buildCodeInterpreterCardData(
  item: JsonObject,
  status: string | undefined,
): ResponsesProviderBuiltinToolCardData {
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

export function buildResponsesProviderBuiltinToolArgumentsJson(
  item: JsonObject,
  toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number],
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

  const card = buildResponsesProviderBuiltinToolCardData(item, toolName);
  const spiritUi: JsonObject = {
    inputExcerpt: card.inputExcerpt,
    ...(card.headlineDetail ? { headlineDetail: card.headlineDetail } : {}),
    ...(card.sourceCount ? { sourceCount: card.sourceCount } : {}),
    ...(card.outputExcerpt ? { outputExcerpt: card.outputExcerpt } : {}),
    ...(card.detailLines && card.detailLines.length > 0 ? { detailLines: card.detailLines } : {}),
  };
  payload[RESPONSES_PROVIDER_BUILTIN_SPIRIT_UI_KEY] = spiritUi;

  return JSON.stringify(payload);
}

function readStringField(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArrayField(record: JsonObject, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function truncateHeadlineDetail(value: string, max = HEADLINE_DETAIL_MAX): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}…`;
}

export type ResponsesProviderBuiltinPreviewStreamState = {
  nextPreviewIndex: number;
  items: Map<
    string,
    {
      toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number];
      item: JsonObject;
    }
  >;
};

export function createResponsesProviderBuiltinPreviewStreamState(
  nextPreviewIndex = 0,
): ResponsesProviderBuiltinPreviewStreamState {
  return {
    nextPreviewIndex,
    items: new Map(),
  };
}

const PROVIDER_BUILTIN_LIFECYCLE_CHUNK_TYPES: ReadonlyArray<{
  chunkType: string;
  toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number];
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

function readProviderBuiltinItemId(chunk: JsonObject): string | undefined {
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

function providerBuiltinOutputItemTypeForToolName(
  toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number],
): string {
  switch (toolName) {
    case 'web_search':
      return 'web_search_call';
    case 'web_extractor':
      return 'web_extractor_call';
    case 'code_interpreter':
      return 'code_interpreter_call';
    default:
      return toolName;
  }
}

function emitProviderBuiltinToolPreview(
  item: JsonObject,
  toolName: (typeof RESPONSES_PROVIDER_BUILTIN_TOOL_NAMES)[number],
  state: ResponsesProviderBuiltinPreviewStreamState,
): { events: LlmStreamEvent[]; state: ResponsesProviderBuiltinPreviewStreamState } {
  const callId =
    readStringField(item, 'id')
    ?? readStringField(item, 'call_id')
    ?? `provider-${toolName}-${state.nextPreviewIndex}`;

  const mergedItem: JsonObject = {
    ...(state.items.get(callId)?.item ?? {}),
    ...item,
    id: callId,
    type: providerBuiltinOutputItemTypeForToolName(toolName),
  };
  state.items.set(callId, { toolName, item: mergedItem });

  return {
    events: [
      {
        kind: 'streaming-tool-preview',
        toolCallId: callId,
        toolName,
        argumentsJson: buildResponsesProviderBuiltinToolArgumentsJson(mergedItem, toolName),
      },
    ],
    state,
  };
}

function coerceProviderBuiltinPreviewStreamState(
  stateOrIndex: ResponsesProviderBuiltinPreviewStreamState | number,
): ResponsesProviderBuiltinPreviewStreamState {
  if (typeof stateOrIndex === 'number') {
    return createResponsesProviderBuiltinPreviewStreamState(stateOrIndex);
  }
  return stateOrIndex;
}

export function accumulateResponsesProviderBuiltinToolPreviewsFromRawChunk(
  rawValue: unknown,
  stateOrIndex: ResponsesProviderBuiltinPreviewStreamState | number = 0,
): {
  events: LlmStreamEvent[];
  state: ResponsesProviderBuiltinPreviewStreamState;
  /** @deprecated Use `state.nextPreviewIndex`. */
  nextPreviewIndex: number;
} {
  const state = coerceProviderBuiltinPreviewStreamState(stateOrIndex);

  if (!isJsonObject(rawValue as JsonValue) || typeof (rawValue as JsonObject).type !== 'string') {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  const chunk = rawValue as JsonObject;
  const chunkType = chunk.type;

  for (const lifecycle of PROVIDER_BUILTIN_LIFECYCLE_CHUNK_TYPES) {
    if (chunkType !== lifecycle.chunkType) {
      continue;
    }
    const itemId = readProviderBuiltinItemId(chunk);
    if (!itemId) {
      return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
    }
    const existing = state.items.get(itemId);
    const item: JsonObject = {
      ...(existing?.item ?? {}),
      id: itemId,
      type: providerBuiltinOutputItemTypeForToolName(lifecycle.toolName),
      status: lifecycle.status,
    };
    const emitted = emitProviderBuiltinToolPreview(item, lifecycle.toolName, state);
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
  const toolName = responsesProviderBuiltinToolNameFromOutputItemType(itemType);
  if (!toolName) {
    return { events: [], state, nextPreviewIndex: state.nextPreviewIndex };
  }

  const emitted = emitProviderBuiltinToolPreview(item, toolName, state);
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
