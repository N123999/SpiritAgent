import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeOpenAiApiBase } from '@spirit-agent/host-internal';

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

function modelCatalogCacheFilePath(apiBase: string): string {
  const normalized = normalizeOpenAiApiBase(apiBase);
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32);
  return path.join(modelCatalogCacheDir(), `${hash}.json`);
}

export interface ModelCatalogCacheEntry {
  apiBase: string;
  fetchedAtUnixMs: number;
  modelIds: string[];
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
  return {
    apiBase: base.trim(),
    fetchedAtUnixMs: fetchedAt,
    modelIds: ids,
    ...(apiKeyFingerprint !== undefined ? { apiKeyFingerprint } : {}),
  };
}

/**
 * @param apiKey 若传入，则仅当缓存条目的 `apiKeyFingerprint` 与其一致时才命中（旧条目无指纹视为未命中）。
 */
export async function readModelCatalogCache(
  apiBase: string,
  apiKey?: string,
): Promise<ModelCatalogCacheEntry | undefined> {
  try {
    const raw = await readFile(modelCatalogCacheFilePath(apiBase), 'utf8');
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
export function readModelCatalogCacheSync(apiBase: string): ModelCatalogCacheEntry | undefined {
  try {
    const raw = readFileSync(modelCatalogCacheFilePath(apiBase), 'utf8');
    return parseCacheEntry(raw);
  } catch {
    return undefined;
  }
}

export async function writeModelCatalogCache(
  apiBase: string,
  modelIds: string[],
  apiKey: string,
): Promise<void> {
  const dir = modelCatalogCacheDir();
  await mkdir(dir, { recursive: true });
  const normalized = normalizeOpenAiApiBase(apiBase);
  const entry: ModelCatalogCacheEntry = {
    apiBase: normalized,
    fetchedAtUnixMs: Date.now(),
    modelIds: [...modelIds],
    apiKeyFingerprint: modelCatalogApiKeyFingerprint(apiKey),
  };
  const filePath = modelCatalogCacheFilePath(apiBase);
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
