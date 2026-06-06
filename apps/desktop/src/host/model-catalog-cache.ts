import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal';

import type {
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  PreviewModelCatalogEntry,
  PreviewModelCatalogPricing,
} from '../types.js';

import { spiritAgentDataDir } from './storage.js';

/** 模型目录缓存 TTL（24h）。 */
export const MODEL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 与 `writeModelCatalogCache` 写入的 `apiKeyFingerprint` 一致，供调用方比对。 */
export function modelCatalogApiKeyFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim(), 'utf8').digest('hex').slice(0, 24);
}

const CACHE_DIR_NAME = 'model-catalog-cache';

function modelCatalogCacheDir(): string {
  return path.join(spiritAgentDataDir(), CACHE_DIR_NAME);
}

function modelCatalogCacheKey(
  apiBase: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  const normalized = normalizeOpenAiApiBase(apiBase);
  return `${provider ?? 'custom'}::${transportKind ?? 'openai-compatible'}::${normalized}`;
}

function modelCatalogCacheFilePath(
  apiBase: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): string {
  const hash = createHash('sha256')
    .update(modelCatalogCacheKey(apiBase, provider, transportKind), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return path.join(modelCatalogCacheDir(), `${hash}.json`);
}

export interface ModelCatalogCacheEntry {
  provider?: DesktopModelProvider;
  transportKind?: DesktopTransportKind;
  apiBase: string;
  fetchedAtUnixMs: number;
  modelIds: string[];
  modelCatalog?: PreviewModelCatalogEntry[];
  /** 写入时 API Key 的指纹；缺省为旧版缓存条目。 */
  apiKeyFingerprint?: string;
}

function parseCacheEntry(raw: string): ModelCatalogCacheEntry | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const obj = parsed as Record<string, unknown>;
  const fetchedAt = obj.fetchedAtUnixMs;
  const modelIds = obj.modelIds;
  const modelCatalog = normalizePreviewModelCatalog(obj.modelCatalog);
  const base = obj.apiBase;
  if (typeof fetchedAt !== 'number' || !Array.isArray(modelIds)) {
    return undefined;
  }
  const ids = modelIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (typeof base !== 'string' || base.trim().length === 0) {
    return undefined;
  }
  const fpRaw = obj.apiKeyFingerprint;
  const apiKeyFingerprint =
    typeof fpRaw === 'string' && fpRaw.length > 0 ? fpRaw : undefined;
  const provider =
    typeof obj.provider === 'string' && obj.provider.trim().length > 0
      ? (obj.provider.trim() as DesktopModelProvider)
      : undefined;
  const transportKind =
    obj.transportKind === 'openai-compatible'
      || obj.transportKind === 'open-responses'
      || obj.transportKind === 'anthropic'
      ? obj.transportKind
      : undefined;
  const entry: ModelCatalogCacheEntry = {
    apiBase: base.trim(),
    fetchedAtUnixMs: fetchedAt,
    modelIds: ids,
    ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(transportKind !== undefined ? { transportKind } : {}),
    ...(apiKeyFingerprint !== undefined ? { apiKeyFingerprint } : {}),
  };
  if (isContextUsageCatalogCacheStale(entry)) {
    return undefined;
  }
  return entry;
}

/** Gateway/OpenRouter 圆环依赖 contextLength；旧版写入漏字段时视为未命中以触发重拉。 */
function isContextUsageCatalogCacheStale(entry: ModelCatalogCacheEntry): boolean {
  if (entry.provider !== 'vercel-ai-gateway' && entry.provider !== 'openrouter') {
    return false;
  }
  if (!entry.modelCatalog || entry.modelCatalog.length === 0) {
    return false;
  }
  return !entry.modelCatalog.some(
    (item) => typeof item.contextLength === 'number' && item.contextLength > 0,
  );
}

/**
 * @param apiKey 若传入，则仅当缓存条目的 `apiKeyFingerprint` 与其一致时才命中（旧条目无指纹视为未命中）。
 */
export async function readModelCatalogCache(
  apiBase: string,
  apiKey?: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): Promise<ModelCatalogCacheEntry | undefined> {
  try {
    const raw = await readFile(modelCatalogCacheFilePath(apiBase, provider, transportKind), 'utf8');
    const entry = parseCacheEntry(raw);
    if (!entry) {
      return undefined;
    }
    const trimmedKey = apiKey?.trim() ?? '';
    if (trimmedKey.length > 0) {
      const expected = modelCatalogApiKeyFingerprint(trimmedKey);
      if (entry.apiKeyFingerprint !== expected) {
        return undefined;
      }
    }
    return entry;
  } catch {
    return undefined;
  }
}

/** 同步读取（仅宿主线程用于快照拼装）。 */
export function readModelCatalogCacheSync(
  apiBase: string,
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): ModelCatalogCacheEntry | undefined {
  try {
    const raw = readFileSync(modelCatalogCacheFilePath(apiBase, provider, transportKind), 'utf8');
    return parseCacheEntry(raw);
  } catch {
    return undefined;
  }
}

export async function writeModelCatalogCache(
  apiBase: string,
  modelIds: string[],
  apiKey: string,
  modelCatalog?: PreviewModelCatalogEntry[],
  provider?: DesktopModelProvider,
  transportKind?: DesktopTransportKind,
): Promise<void> {
  const dir = modelCatalogCacheDir();
  await mkdir(dir, { recursive: true });
  const normalized = normalizeOpenAiApiBase(apiBase);
  const entry: ModelCatalogCacheEntry = {
    apiBase: normalized,
    fetchedAtUnixMs: Date.now(),
    modelIds: [...modelIds],
    ...(modelCatalog !== undefined ? { modelCatalog: clonePreviewModelCatalog(modelCatalog) } : {}),
    apiKeyFingerprint: modelCatalogApiKeyFingerprint(apiKey),
    ...(provider ? { provider } : {}),
    ...(transportKind ? { transportKind } : {}),
  };
  const filePath = modelCatalogCacheFilePath(apiBase, provider, transportKind);
  const tempPath = `${filePath}.${String(process.pid)}.${String(Math.random()).slice(2)}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(entry)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

export function isModelCatalogCacheFresh(
  entry: ModelCatalogCacheEntry,
  nowMs: number,
  forceRefresh: boolean,
): boolean {
  if (forceRefresh) {
    return false;
  }
  return nowMs - entry.fetchedAtUnixMs < MODEL_CATALOG_CACHE_TTL_MS;
}

function normalizePreviewModelCatalog(value: unknown): PreviewModelCatalogEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: PreviewModelCatalogEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : undefined;
    if (!id) {
      continue;
    }
    const displayName =
      typeof record.displayName === 'string' && record.displayName.trim().length > 0
        ? record.displayName.trim()
        : undefined;
    const description =
      typeof record.description === 'string' && record.description.trim().length > 0
        ? record.description.trim()
        : undefined;
    const pricing = normalizeCachedPricing(record.pricing);
    const capabilities = normalizeCachedCapabilities(record.capabilities);
    const supportedReasoningEfforts = normalizeCachedSupportedReasoningEfforts(record.supportedReasoningEfforts);
    const contextLength =
      typeof record.contextLength === 'number'
      && Number.isFinite(record.contextLength)
      && record.contextLength > 0
        ? Math.trunc(record.contextLength)
        : undefined;
    normalized.push({
      id,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(pricing !== undefined ? { pricing } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts } : {}),
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCachedPricing(value: unknown): PreviewModelCatalogPricing | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const inputPerTokenUsd = readCachedPricingField(record, 'inputPerTokenUsd');
  const outputPerTokenUsd = readCachedPricingField(record, 'outputPerTokenUsd');
  const imagePerUnitUsd = readCachedPricingField(record, 'imagePerUnitUsd');
  const requestPerCallUsd = readCachedPricingField(record, 'requestPerCallUsd');
  if (!inputPerTokenUsd && !outputPerTokenUsd && !imagePerUnitUsd && requestPerCallUsd === undefined) {
    return undefined;
  }
  return {
    ...(inputPerTokenUsd ? { inputPerTokenUsd } : {}),
    ...(outputPerTokenUsd ? { outputPerTokenUsd } : {}),
    ...(imagePerUnitUsd ? { imagePerUnitUsd } : {}),
    ...(requestPerCallUsd !== undefined ? { requestPerCallUsd } : {}),
  };
}

function readCachedPricingField(
  record: Record<string, unknown>,
  key: keyof PreviewModelCatalogPricing,
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCachedCapabilities(value: unknown): DesktopModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<DesktopModelCapability>(['chat', 'image', 'video', 'imageGeneration', 'videoGeneration']);
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalizedItem = item === 'vision' ? 'image' : item;
    if (!allowed.has(normalizedItem as DesktopModelCapability)) {
      continue;
    }
    const capability = normalizedItem as DesktopModelCapability;
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCachedSupportedReasoningEfforts(
  value: unknown,
): DesktopModelReasoningEffort[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const effort = item.trim().toLowerCase();
    if (!effort || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
}

function clonePreviewModelCatalog(
  entries: readonly PreviewModelCatalogEntry[],
): PreviewModelCatalogEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.pricing !== undefined ? { pricing: { ...entry.pricing } } : {}),
    ...(entry.capabilities ? { capabilities: [...entry.capabilities] } : {}),
    ...(entry.supportedReasoningEfforts !== undefined
      ? { supportedReasoningEfforts: [...entry.supportedReasoningEfforts] }
      : {}),
    ...(entry.contextLength !== undefined ? { contextLength: entry.contextLength } : {}),
  }));
}
