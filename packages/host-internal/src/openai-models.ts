/**
 * OpenAI-compatible `GET /v1/models` listing (host-side; no secrets stored here).
 */

import type { ModelProviderId } from './model-provider-presets.js';

export type ProviderModelTransportKind = 'openai-compatible' | 'anthropic';

export interface ProviderListedModelEntry {
  id: string;
  supportsVision?: boolean;
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
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    return [];
  }
  const raw = (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || !('id' in entry)) {
      continue;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim().length > 0) {
      ids.push(id.trim());
    }
  }
  return ids;
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
      const supportsVision = anthropicModelSupportsVision(record.capabilities);
      if (supportsVision !== undefined) {
        modelEntry.supportsVision = supportsVision;
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

  const ids = parseOpenAiModelsPayload(json);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
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
  if (options.transportKind === 'anthropic' || options.provider === 'anthropic') {
    return listAnthropicModels(options);
  }

  return (await listOpenAiCompatibleModelIds(options)).map((id) => ({ id }));
}

export async function listProviderModelIds(
  options: ListProviderModelIdsOptions,
): Promise<string[]> {
  return (await listProviderModels(options)).map((entry) => entry.id);
}

function anthropicModelSupportsVision(value: unknown): boolean | undefined {
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
      ...(entry.supportsVision !== undefined ? { supportsVision: entry.supportsVision } : {}),
      ...(entry.supportedReasoningEfforts !== undefined
        ? { supportedReasoningEfforts: [...entry.supportedReasoningEfforts] }
        : {}),
    });
  }
  return deduped;
}

const ANTHROPIC_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
