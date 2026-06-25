/**
 * OpenAI-compatible `GET /v1/models` listing (host-side; no secrets stored here).
 */

import { gatewayAnthropicClaudeSupportedEfforts } from '@spirit-agent/core';

import type { ModelProviderId, ProviderModelTransportKind } from './model-provider-presets.js';
import { resolveProviderConnectApiBase } from './model-provider-presets.js';
import {
  assertGoogleGeminiApiBase,
  googleNativeModelsListUrl,
} from './google-gemini-endpoints.js';
import { bedrockApiBaseFromRegion, extractAwsRegionFromBedrockApiBase } from './bedrock-region.js';
import { extractVertexProjectAndLocationFromApiBase } from './google-vertex-endpoints.js';
import { normalizeOpenAiApiBase } from './openai-api-base.js';

export { normalizeOpenAiApiBase } from './openai-api-base.js';

export type { ProviderModelTransportKind };

export interface ProviderListedModelPricing {
  inputPerTokenUsd?: string;
  outputPerTokenUsd?: string;
  imagePerUnitUsd?: string;
  requestPerCallUsd?: string;
}

export interface ProviderListedModelEntry {
  id: string;
  displayName?: string;
  description?: string;
  pricing?: ProviderListedModelPricing;
  supportsImageInput?: boolean;
  supportsVideoInput?: boolean;
  supportsVideoGeneration?: boolean;
  supportsImageGeneration?: boolean;
  supportsReasoning?: boolean;
  contextLength?: number;
  supportedReasoningEfforts?: string[];
}

export const OPENAI_MODELS_PATH = '/models';
export const ANTHROPIC_MODELS_PATH = '/models';
const ANTHROPIC_VERSION = '2023-06-01';

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

  if (provider === 'volcengine') {
    return parseVolcengineModelEntriesPayload(body);
  }

  if (provider === 'xiaomi') {
    return parseXiaomiModelEntriesPayload(body);
  }

  if (provider === 'siliconflow') {
    return parseSiliconFlowModelEntriesPayload(body, 'chat');
  }

  if (provider === 'google') {
    return parseGoogleModelEntriesPayload(body);
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

export type SiliconFlowModelListKind = 'chat' | 'image' | 'video';

/** SiliconFlow `GET /v1/models`：OpenAI-shaped list；能力由请求 query 来源标注。 */
export function parseSiliconFlowModelEntriesPayload(
  body: unknown,
  kind: SiliconFlowModelListKind,
): ProviderListedModelEntry[] {
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
    if (typeof id !== 'string' || id.trim().length === 0) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id: id.trim() };
    switch (kind) {
      case 'image':
        modelEntry.supportsImageGeneration = true;
        break;
      case 'video':
        modelEntry.supportsVideoGeneration = true;
        break;
      case 'chat':
        if (inferSiliconFlowVisionInputFromModelId(modelEntry.id)) {
          modelEntry.supportsImageInput = true;
        }
        break;
      default:
        break;
    }
    entries.push(modelEntry);
  }
  return entries;
}

function inferSiliconFlowVisionInputFromModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.includes('vl')
    || normalized.includes('vision')
    || normalized.includes('omni')
    || normalized.includes('multimodal')
  );
}

function mergeSiliconFlowListedModelEntries(
  entries: readonly ProviderListedModelEntry[],
): ProviderListedModelEntry[] {
  const byId = new Map<string, ProviderListedModelEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, { ...entry });
      continue;
    }
    byId.set(entry.id, {
      ...existing,
      ...entry,
      ...(existing.supportsImageInput || entry.supportsImageInput
        ? { supportsImageInput: true }
        : {}),
      ...(existing.supportsVideoInput || entry.supportsVideoInput
        ? { supportsVideoInput: true }
        : {}),
      ...(existing.supportsImageGeneration || entry.supportsImageGeneration
        ? { supportsImageGeneration: true }
        : {}),
      ...(existing.supportsVideoGeneration || entry.supportsVideoGeneration
        ? { supportsVideoGeneration: true }
        : {}),
      ...(existing.supportsReasoning || entry.supportsReasoning
        ? { supportsReasoning: true }
        : {}),
      ...(existing.contextLength ?? entry.contextLength
        ? { contextLength: existing.contextLength ?? entry.contextLength }
        : {}),
      ...(existing.supportedReasoningEfforts ?? entry.supportedReasoningEfforts
        ? {
            supportedReasoningEfforts:
              existing.supportedReasoningEfforts ?? entry.supportedReasoningEfforts,
          }
        : {}),
    });
  }
  return [...byId.values()];
}

async function fetchSiliconFlowModelsPayload(
  options: ListOpenAiCompatibleModelIdsOptions,
  query: string,
): Promise<unknown> {
  const baseListUrl = openAiCompatibleModelsListUrl(options.baseUrl);
  const url = `${baseListUrl}?${query}`;
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error('API Key 不能为空。');
  }

  const init: RequestInit = {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };
  return fetchModelsListJson(url, init);
}

export async function listSiliconFlowModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const queries: Array<{ kind: SiliconFlowModelListKind; query: string }> = [
    { kind: 'chat', query: 'type=text&sub_type=chat' },
    { kind: 'image', query: 'type=image' },
    { kind: 'video', query: 'sub_type=text-to-video' },
  ];

  const allEntries: ProviderListedModelEntry[] = [];
  for (const { kind, query } of queries) {
    const json = await fetchSiliconFlowModelsPayload(options, query);
    allEntries.push(...parseSiliconFlowModelEntriesPayload(json, kind));
  }

  return mergeSiliconFlowListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
}

/** Xiaomi Mimo：上游 /models 不返回能力字段，多模态模型需维护 allowlist。 */
const XIAOMI_MULTIMODAL_MODEL_IDS = new Set(['mimo-v2.5', 'mimo-v2-omni']);

export function parseXiaomiModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
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
    if (typeof id !== 'string' || id.trim().length === 0) {
      continue;
    }

    const modelId = id.trim();
    const isMultimodal = XIAOMI_MULTIMODAL_MODEL_IDS.has(modelId);
    entries.push({
      id: modelId,
      supportsImageInput: isMultimodal,
      supportsVideoInput: isMultimodal,
    });
  }
  return entries;
}

const SKIPPED_VOLCENGINE_MODEL_STATUSES = new Set(['shutdown', 'retiring']);

function readVolcengineModalities(value: unknown): string[] {
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

function readVolcengineInputModalities(record: Record<string, unknown>): string[] {
  const modalities = asRecord(record.modalities);
  return readVolcengineModalities(modalities?.input_modalities);
}

/**
 * Volcengine Ark `GET /api/v3/models`: OpenAI-shaped list with `domain`, `modalities`, `status`.
 */
export function parseVolcengineModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
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

    const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
    if (status && SKIPPED_VOLCENGINE_MODEL_STATUSES.has(status)) {
      continue;
    }

    const domain = typeof record.domain === 'string' ? record.domain.trim() : '';
    const modelEntry: ProviderListedModelEntry = { id: id.trim() };

    const displayName = typeof record.name === 'string' ? record.name.trim() : '';
    if (displayName.length > 0) {
      modelEntry.displayName = displayName;
    }

    const tokenLimits = asRecord(record.token_limits);
    const contextWindow = readPositiveIntegerModelTrait(
      tokenLimits ?? {},
      'context_window',
    );
    if (contextWindow !== undefined) {
      modelEntry.contextLength = contextWindow;
    }

    switch (domain) {
      case 'VideoGeneration':
        modelEntry.supportsVideoGeneration = true;
        break;
      case 'ImageGeneration':
        modelEntry.supportsImageGeneration = true;
        break;
      case 'VLM': {
        const inputModalities = readVolcengineInputModalities(record);
        if (inputModalities.includes('image')) {
          modelEntry.supportsImageInput = true;
        }
        if (inputModalities.includes('video')) {
          modelEntry.supportsVideoInput = true;
        }
        break;
      }
      default:
        break;
    }

    entries.push(modelEntry);
  }
  return entries;
}

/**
 * Gemini API 原生 `GET /v1beta/models` 列表。
 * 仅保留 `supportedGenerationMethods` 含 `generateContent` 的模型。
 */
export function parseGoogleModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null || !('models' in body)) {
    return [];
  }
  const raw = (body as { models?: unknown }).models;
  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;

    const methods = record.supportedGenerationMethods;
    if (!Array.isArray(methods) || !methods.includes('generateContent')) {
      continue;
    }

    const baseModelId = readOptionalTrimmedString(record.baseModelId);
    const name = readOptionalTrimmedString(record.name);
    let id = baseModelId;
    if (!id && name) {
      id = name.startsWith('models/') ? name.slice('models/'.length) : name;
    }
    if (!id) {
      continue;
    }

    const modelEntry: ProviderListedModelEntry = { id };
    const displayName = readOptionalTrimmedString(record.displayName);
    const description = readOptionalTrimmedString(record.description);
    if (displayName) {
      modelEntry.displayName = displayName;
    }
    if (description) {
      modelEntry.description = description;
    }

    const inputLimit = readPositiveIntegerModelTrait(record, 'inputTokenLimit');
    const outputLimit = readPositiveIntegerModelTrait(record, 'outputTokenLimit');
    if (inputLimit !== undefined && outputLimit !== undefined) {
      modelEntry.contextLength = inputLimit + outputLimit;
    }

    entries.push(modelEntry);
  }
  return entries;
}

const SKIPPED_VERCEL_GATEWAY_MODEL_TYPES = new Set(['embedding', 'reranking']);

function attachGatewayAnthropicReasoningEfforts(
  modelEntry: ProviderListedModelEntry,
): ProviderListedModelEntry {
  const supportedReasoningEfforts = gatewayAnthropicClaudeSupportedEfforts(modelEntry.id);
  if (supportedReasoningEfforts === undefined) {
    return modelEntry;
  }

  return {
    ...modelEntry,
    supportedReasoningEfforts,
  };
}

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
      entries.push(
        attachListedModelMetadata({ id: id.trim() }, record, readVercelGatewayPricing(record)),
      );
      continue;
    }

    if (type === 'image') {
      entries.push(
        attachListedModelMetadata(
          { id: id.trim(), supportsImageGeneration: true },
          record,
          readVercelGatewayPricing(record),
        ),
      );
      continue;
    }

    if (type === 'language') {
      const modelEntry: ProviderListedModelEntry = { id: id.trim() };
      const contextLength = readPositiveIntegerModelTrait(record, 'context_window');
      if (contextLength !== undefined) {
        modelEntry.contextLength = contextLength;
      }
      entries.push(
        attachListedModelMetadata(modelEntry, record, readVercelGatewayPricing(record)),
      );
      continue;
    }

    if (type === 'video') {
      entries.push(
        attachListedModelMetadata(
          { id: id.trim(), supportsVideoGeneration: true },
          record,
          readVercelGatewayPricing(record),
        ),
      );
      continue;
    }

    entries.push(
      attachListedModelMetadata({ id: id.trim() }, record, readVercelGatewayPricing(record)),
    );
  }
  return entries.map(attachGatewayAnthropicReasoningEfforts);
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
        entries.push(
          attachListedModelMetadata(
            { id: id.trim(), supportsImageGeneration: true },
            record,
            readOpenRouterPricing(record),
          ),
        );
        continue;
      }
    }

    entries.push(
      attachListedModelMetadata({ id: id.trim() }, record, readOpenRouterPricing(record)),
    );
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
  awsRegion?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  vertexProject?: string;
  vertexLocation?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
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
  if (options.provider === 'xiaomi' && options.transportKind === 'anthropic') {
    return listXiaomiModels({
      baseUrl: resolveProviderConnectApiBase('xiaomi', 'openai-compatible'),
      apiKey: options.apiKey,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
  }

  if (options.provider === 'siliconflow') {
    return listSiliconFlowModels(options);
  }

  if (
    options.transportKind === 'anthropic'
    || options.provider === 'anthropic'
  ) {
    return listAnthropicModels(options);
  }

  if (options.provider === 'moonshot-ai') {
    return listMoonshotModels(options);
  }

  if (options.provider === 'xiaomi') {
    return listXiaomiModels(options);
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

  if (options.provider === 'volcengine') {
    return listVolcengineModels(options);
  }

  if (options.provider === 'google') {
    return listGoogleModels(options);
  }

  if (options.provider === 'google-vertex-ai') {
    return listGoogleVertexProviderModels(options);
  }

  if (options.provider === 'amazon-bedrock') {
    return listBedrockProviderModels(options);
  }

  if (options.provider === 'azure') {
    throw new Error('Azure 无 /models 端点，请手动填写部署名。');
  }

  return listOpenAiCompatibleModels(options);
}

export async function listGoogleVertexProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const extracted = extractVertexProjectAndLocationFromApiBase(options.baseUrl);
  const project = options.vertexProject?.trim() || extracted.project;
  const location = options.vertexLocation?.trim() || extracted.location;
  if (!project || !location) {
    throw new Error('Google Vertex 列模型需要填写 GCP 项目 ID 与区域（location）。');
  }

  try {
    const { listVertexModels } = await import('./google-vertex-models.js');
    return await listVertexModels({
      project,
      location,
      ...(options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
      ...(options.vertexClientEmail?.trim()
        ? { vertexClientEmail: options.vertexClientEmail.trim() }
        : {}),
      ...(options.vertexPrivateKey?.trim()
        ? { vertexPrivateKey: options.vertexPrivateKey.trim() }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`列模型失败（Google Vertex AI）：${message}`);
  }
}

export async function listBedrockProviderModels(
  options: ListProviderModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  const region = options.awsRegion?.trim() || extractAwsRegionFromBedrockApiBase(options.baseUrl);
  if (!region) {
    throw new Error('Amazon Bedrock 列模型需要填写 AWS 区域。');
  }

  try {
    const { listBedrockModels } = await import('./bedrock-models.js');
    return await listBedrockModels({
      region,
      ...(options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
      ...(options.accessKeyId?.trim() ? { accessKeyId: options.accessKeyId.trim() } : {}),
      ...(options.secretAccessKey?.trim() ? { secretAccessKey: options.secretAccessKey.trim() } : {}),
      ...(options.sessionToken?.trim() ? { sessionToken: options.sessionToken.trim() } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`列模型失败（Amazon Bedrock）：${message}`);
  }
}

export { bedrockApiBaseFromRegion, extractAwsRegionFromBedrockApiBase } from './bedrock-region.js';
export {
  vertexApiBaseFromProjectAndLocation,
  extractVertexProjectAndLocationFromApiBase,
} from './google-vertex-endpoints.js';

export async function listMoonshotModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'moonshot-ai');
}

export async function listXiaomiModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'xiaomi');
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

export async function listVolcengineModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  return listOpenAiCompatibleModelsForProvider(options, 'volcengine');
}

/**
 * Google Gemini：模型目录走原生 `/v1beta/models`（非 OpenAI 兼容 `/openai/models`）。
 * 本机/CI 通常无法直连 generativelanguage.googleapis.com；联调需在有网络的环境手动验证。
 */
export async function listGoogleModels(
  options: ListOpenAiCompatibleModelIdsOptions,
): Promise<ProviderListedModelEntry[]> {
  assertGoogleGeminiApiBase(options.baseUrl);
  const key = options.apiKey.trim();
  if (!key) {
    throw new Error('API Key 不能为空。');
  }

  const allEntries: ProviderListedModelEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = googleNativeModelsListUrl(options.baseUrl, pageToken);
    const headers: Record<string, string> = {
      'x-goog-api-key': key,
    };
    const init: RequestInit = { method: 'GET', headers };
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    const json = await fetchModelsListJson(url, init);
    allEntries.push(...parseGoogleModelEntriesPayload(json));

    pageToken =
      typeof json === 'object' && json !== null && 'nextPageToken' in json
        ? readOptionalTrimmedString((json as { nextPageToken?: unknown }).nextPageToken)
        : undefined;
  } while (pageToken);

  return dedupeProviderListedModelEntries(allEntries).sort((a, b) => a.id.localeCompare(b.id));
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
      ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
      ...(entry.supportsImageInput !== undefined
        ? { supportsImageInput: entry.supportsImageInput }
        : {}),
      ...(entry.supportsVideoInput !== undefined
        ? { supportsVideoInput: entry.supportsVideoInput }
        : {}),
      ...(entry.supportsVideoGeneration !== undefined
        ? { supportsVideoGeneration: entry.supportsVideoGeneration }
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

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPricingField(pricing: Record<string, unknown>, key: string): string | undefined {
  return readOptionalTrimmedString(pricing[key]);
}

function buildProviderListedModelPricing(fields: ProviderListedModelPricing): ProviderListedModelPricing | undefined {
  if (
    !fields.inputPerTokenUsd
    && !fields.outputPerTokenUsd
    && !fields.imagePerUnitUsd
    && !fields.requestPerCallUsd
  ) {
    return undefined;
  }
  return {
    ...(fields.inputPerTokenUsd ? { inputPerTokenUsd: fields.inputPerTokenUsd } : {}),
    ...(fields.outputPerTokenUsd ? { outputPerTokenUsd: fields.outputPerTokenUsd } : {}),
    ...(fields.imagePerUnitUsd ? { imagePerUnitUsd: fields.imagePerUnitUsd } : {}),
    ...(fields.requestPerCallUsd ? { requestPerCallUsd: fields.requestPerCallUsd } : {}),
  };
}

function readVercelGatewayPricing(record: Record<string, unknown>): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = readPricingField(pricing, 'input');
  const outputPerTokenUsd = readPricingField(pricing, 'output');
  const imagePerUnitUsd = readPricingField(pricing, 'image');
  const requestPerCallUsd = readPricingField(pricing, 'request');
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
  });
}

function readOpenRouterPricing(record: Record<string, unknown>): ProviderListedModelPricing | undefined {
  const pricing = asRecord(record.pricing);
  if (!pricing) {
    return undefined;
  }
  const inputPerTokenUsd = readPricingField(pricing, 'prompt');
  const outputPerTokenUsd = readPricingField(pricing, 'completion');
  const imagePerUnitUsd = readPricingField(pricing, 'image');
  const requestPerCallUsd = readPricingField(pricing, 'request');
  return buildProviderListedModelPricing({
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
  });
}

function attachListedModelMetadata(
  modelEntry: ProviderListedModelEntry,
  record: Record<string, unknown>,
  pricing?: ProviderListedModelPricing,
): ProviderListedModelEntry {
  const displayName = readOptionalTrimmedString(record.name);
  const description = readOptionalTrimmedString(record.description);
  const contextLength =
    modelEntry.contextLength ?? readPositiveIntegerModelTrait(record, 'context_length');
  return {
    ...modelEntry,
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(pricing ? { pricing } : {}),
    ...(contextLength !== undefined ? { contextLength } : {}),
  };
}

export function moonshotSupportedReasoningEfforts(supportsReasoning: boolean): string[] {
  return supportsReasoning ? ['minimal', 'low', 'medium', 'high'] : [];
}

const ANTHROPIC_REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
