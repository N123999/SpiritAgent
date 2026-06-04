/**
 * OpenAI-compatible `GET /v1/models` listing (host-side; no secrets stored here).
 */

import type { ModelProviderId, ProviderModelTransportKind } from './model-provider-presets.js';

export type { ProviderModelTransportKind };

export interface ProviderListedModelEntry {
  id: string;
  supportsImageInput?: boolean;
  supportsVideoInput?: boolean;
  supportsImageGeneration?: boolean;
  supportsReasoning?: boolean;
  contextLength?: number;
  supportedReasoningEfforts?: string[];
}

export const OPENAI_MODELS_PATH = '/models';
export const ANTHROPIC_MODELS_PATH = '/models';
const ANTHROPIC_VERSION = '2023-06-01';

/** Trim and remove trailing slashes from API root (e.g. `https://host/v1`). */
export function normalizeOpenAiApiBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** Full URL for the models list request. */
export function openAiCompatibleModelsListUrl(baseUrl: string): string {
  return `${normalizeOpenAiApiBase(baseUrl)}${OPENAI_MODELS_PATH}`;
}

export function anthropicModelsListUrl(baseUrl: string): string {
  return `${normalizeOpenAiApiBase(baseUrl)}${ANTHROPIC_MODELS_PATH}`;
}

/**
 * Extract model ids from a JSON body shaped like OpenAI's list models response.
 * Tolerates missing `data` by returning an empty list.
 */
export function parseOpenAiModelsPayload(body: unknown): string[] {
  return parseOpenAiCompatibleModelEntriesPayload(body).map((entry) => entry.id);
}

/**
 * OpenAI-shaped `GET /v1/models` list. Moonshot AI extends each item with
 * `supports_image_in`, `supports_video_in`, `supports_reasoning`, and `context_length`.
 */
export function parseOpenAiCompatibleModelEntriesPayload(
  body: unknown,
  provider?: ModelProviderId,
): ProviderListedModelEntry[] {
  if (provider === 'moonshot-ai') {
    return parseMoonshotModelEntriesPayload(body);
  }

  if (provider === 'vercel-ai-gateway') {
    return parseVercelAiGatewayModelEntriesPayload(body);
  }

  if (provider === 'openrouter') {
    return parseOpenRouterModelEntriesPayload(body);
  }

  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim().length > 0) {
      entries.push({ id: id.trim() });
    }
  }
  return entries;
}

export function parseMoonshotModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    const supportsImageInput = readBooleanModelTrait(record, 'supports_image_in');
    if (supportsImageInput !== undefined) {
      modelEntry.supportsImageInput = supportsImageInput;
    }
    const supportsVideoInput = readBooleanModelTrait(record, 'supports_video_in');
    if (supportsVideoInput !== undefined) {
      modelEntry.supportsVideoInput = supportsVideoInput;
    }
    const supportsReasoning = readBooleanModelTrait(record, 'supports_reasoning');
    if (supportsReasoning !== undefined) {
      modelEntry.supportsReasoning = supportsReasoning;
      modelEntry.supportedReasoningEfforts = moonshotSupportedReasoningEfforts(supportsReasoning);
    }
    const contextLength = readPositiveIntegerModelTrait(record, 'context_length');
    if (contextLength !== undefined) {
      modelEntry.contextLength = contextLength;
    }
    entries.push(modelEntry);
  }
  return entries;
}

const SKIPPED_VERCEL_GATEWAY_MODEL_TYPES = new Set(['embedding', 'reranking']);

export function parseVercelAiGatewayModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      continue;
    }

    const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : undefined;
    if (type && SKIPPED_VERCEL_GATEWAY_MODEL_TYPES.has(type)) {
      continue;
    }

    if (!type) {
      entries.push({ id: id.trim() });
      continue;
    }

    if (type === 'image') {
      entries.push({ id: id.trim(), supportsImageGeneration: true });
      continue;
    }

    if (type === 'language') {
      const modelEntry: ProviderListedModelEntry = { id: id.trim() };
      const contextLength = readPositiveIntegerModelTrait(record, 'context_window');
      if (contextLength !== undefined) {
        modelEntry.contextLength = contextLength;
      }
      entries.push(modelEntry);
      continue;
    }

    if (type === 'video') {
      entries.push({ id: id.trim(), supportsVideoInput: true });
      continue;
    }

    entries.push({ id: id.trim() });
  }
  return entries;
}

function readOpenRouterModalities(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const modalities: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      modalities.push(item.trim().toLowerCase());
    }
  }
  return modalities;
}

/** OpenRouter 列表项：`architecture.output_modalities` 优先，其次顶层 `output_modalities`。 */
function readOpenRouterOutputModalities(record: Record<string, unknown>): string[] {
  const architecture = asRecord(record.architecture);
  const fromArchitecture = readOpenRouterModalities(architecture?.output_modalities);
  if (fromArchitecture.length > 0) {
    return fromArchitecture;
  }
  return readOpenRouterModalities(record.output_modalities);
}

/**
 * OpenRouter /models：仅以 output_modalities 区分对话与生图；不用模型 id 或 pricing 推断。
 * 含 image 且不含 text → 生图；含 text → 对话；二者皆无 → 跳过；缺失 → 默认对话。
 */
export function parseOpenRouterModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      continue;
    }

    const outputModalities = readOpenRouterOutputModalities(record);
    if (outputModalities.length > 0) {
      const hasText = outputModalities.includes('text');
      const hasImage = outputModalities.includes('image');
      if (!hasText && !hasImage) {
        continue;
      }
      if (hasImage && !hasText) {
        entries.push({ id: id.trim(), supportsImageGeneration: true });
        continue;
      }
    }

    entries.push({ id: id.trim() });
  }
  return entries;
}

export function parseAnthropicModelsPayload(body: unknown): string[] {
  return parseAnthropicModelEntriesPayload(body).map((entry) => entry.id);
}

export function parseAnthropicModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = record.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      const modelEntry: ProviderListedModelEntry = { id: id.trim() };
      const supportsImageInput = anthropicModelSupportsImageInput(record.capabilities);
      if (supportsImageInput !== undefined) {
        modelEntry.supportsImageInput = supportsImageInput;
      }
      const supportedReasoningEfforts = anthropicSupportedReasoningEfforts(record.capabilities);
      if (supportedReasoningEfforts !== undefined) {
        modelEntry.supportedReasoningEfforts = supportedReasoningEfforts;
      }
      entries.push(modelEntry);
    }
  }
  return entries;
}

export interface ListOpenAiCompatibleModelIdsOptions {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ListAnthropicModelIdsOptions {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface ListProviderModelIdsOptions {
  provider?: ModelProviderId;
  transportKind?: ProviderModelTransportKind;
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

/**
 * `GET {baseUrl}/models` with Bearer auth; returns sorted unique ids.
 * @throws Error with a short Chinese message on network/HTTP/parse failure.
 */
export async function listOpenAiCompatibleModelIds(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<string[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error('API Key 不能为空。');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };

  const init: RequestInit = { method: 'GET', headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const json = await fetchModelsListJson(url, init);
  const ids = parseOpenAiModelsPayload(json);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function fetchModelsListJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`列模型请求失败：${message}`);
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(
      response.ok
        ? '列模型响应不是合法 JSON。'
        : `列模型失败（HTTP ${String(response.status)}）。`,
    );
  }

  if (!response.ok) {
    const errObj = typeof json === 'object' && json !== null ? json : undefined;
    const errMsg =
      errObj && 'error' in errObj && typeof (errObj as { error?: { message?: unknown } }).error?.message === 'string'
        ? (errObj as { error: { message: string } }).error.message
        : undefined;
    throw new Error(
      errMsg && errMsg.trim().length > 0
        ? `列模型失败（HTTP ${String(response.status)}）：${errMsg.trim()}`
        : `列模型失败（HTTP ${String(response.status)}）。`,
    );
  }

  return json;
}

export async function listOpenAiCompatibleModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options);
}

async function listOpenAiCompatibleModelsForProvider(
  options: ListOpenAiCompatibleModelIdsOptions,
  provider?: ModelProviderId,
): Promise<ProviderListedModelEntry[]> {
  const url = openAiCompatibleModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error('API Key 不能为空。');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };

  const init: RequestInit = { method: 'GET', headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  const json = await fetchModelsListJson(url, init);
  const entries = parseOpenAiCompatibleModelEntriesPayload(json, provider);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listAnthropicModelIds(
  options: ListAnthropicModelIdsOptions,
): Promise<string[]> {
  const entries = await listAnthropicModels(options);
  return entries.map((entry) => entry.id);
}

export async function listAnthropicModels(
  options: ListAnthropicModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const url = anthropicModelsListUrl(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error('API Key 不能为空。');
  }

  const headers: Record<string, string> = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
  };

  const init: RequestInit = { method: 'GET', headers };
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`列模型请求失败：${message}`);
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new Error(
      response.ok
        ? '列模型响应不是合法 JSON。'
        : `列模型失败（HTTP ${String(response.status)}）。`,
    );
  }

  if (!response.ok) {
    const errObj = typeof json === 'object' && json !== null ? json as Record<string, unknown> : undefined;
    const error = errObj?.error;
    const errMsg =
      typeof error === 'string'
        ? error
        : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : undefined;
    throw new Error(
      errMsg && errMsg.trim().length > 0
        ? `列模型失败（HTTP ${String(response.status)}）：${errMsg.trim()}`
        : `列模型失败（HTTP ${String(response.status)}）。`,
    );
  }

  const entries = parseAnthropicModelEntriesPayload(json);
  return dedupeProviderListedModelEntries(entries).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  if (
    options.transportKind === 'anthropic'
    || options.provider === 'anthropic'
  ) {
    return listAnthropicModels(options);
  }

  if (options.provider === 'moonshot-ai') {
    return listMoonshotModels(options);
  }

  if (options.provider === 'xai') {
    return listXaiModels(options);
  }

  if (options.provider === 'vercel-ai-gateway') {
    return listVercelAiGatewayModels(options);
  }

  if (options.provider === 'openrouter') {
    return listOpenRouterModels(options);
  }

  return listOpenAiCompatibleModels(options);
}

export async function listMoonshotModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'moonshot-ai');
}

export async function listXaiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'xai');
}

export async function listVercelAiGatewayModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'vercel-ai-gateway');
}

export async function listOpenRouterModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'openrouter');
}

export async function listProviderModelIds(
  options: ListProviderModelIdsOptions,
): Promise<string[]> {
  return (await listProviderModels(options)).map((entry) => entry.id);
}

function anthropicModelSupportsImageInput(value: unknown): boolean | undefined {
  const capabilities = asRecord(value);
  if (!capabilities) {
    return undefined;
  }
  return capabilitySupported(capabilities.image_input);
}

function anthropicSupportedReasoningEfforts(value: unknown): string[] | undefined {
  const capabilities = asRecord(value);
  if (!capabilities) {
    return undefined;
  }
  const effort = asRecord(capabilities.effort);
  if (!effort) {
    return undefined;
  }

  if (capabilitySupported(effort) !== true) {
    return [];
  }

  return ANTHROPIC_REASONING_LEVELS.filter((level) => capabilitySupported(effort[level]) === true);
}

function capabilitySupported(value: unknown): boolean | undefined {
  const record = asRecord(value);
  if (!record || typeof record.supported !== 'boolean') {
    return undefined;
  }
  return record.supported;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function dedupeProviderListedModelEntries(
  entries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const seen = new Set<string>();
  const deduped: ProviderListedModelEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    deduped.push({
      id: entry.id,
      ...(entry.supportsImageInput !== undefined
        ? { supportsImageInput: entry.supportsImageInput }
        : {}),
      ...(entry.supportsVideoInput !== undefined
        ? { supportsVideoInput: entry.supportsVideoInput }
        : {}),
      ...(entry.supportsImageGeneration !== undefined
        ? { supportsImageGeneration: entry.supportsImageGeneration }
        : {}),
      ...(entry.supportsReasoning !== undefined ? { supportsReasoning: entry.supportsReasoning } : {}),
      ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
      ...(entry.supportedReasoningEfforts !== undefined
        ? { supportedReasoningEfforts: [...entry.supportedReasoningEfforts] }
        : {}),
    });
  }
  return deduped;
}

function readBooleanModelTrait(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function readPositiveIntegerModelTrait(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function moonshotSupportedReasoningEfforts(supportsReasoning: boolean): string[] {
  return supportsReasoning ? ['minimal', 'low', 'medium', 'high'] : [];
}

const ANTHROPIC_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
