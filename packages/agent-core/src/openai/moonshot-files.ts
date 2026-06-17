import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { getLlmFetch } from '../llm-fetch.js';
import type { OpenAiTransportConfig } from './openai-compat.js';

/** Moonshot AI 视频理解：经 Files API 上传，purpose 必须为 video。 */
const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';

const uploadCache = new Map<string, string>();

export function normalizeOpenAiCompatibleApiBase(baseUrl: string | undefined): string {
  return (baseUrl ?? '').trim().replace(/\/+$/, '');
}

export function normalizeMoonshotApiBase(baseUrl: string | undefined): string {
  return normalizeOpenAiCompatibleApiBase(baseUrl ?? DEFAULT_MOONSHOT_BASE_URL);
}

/** OpenAI 兼容 Files API（purpose=video）→ `ms://{fileId}`，供 Moonshot 等支持 Files 上传的厂商使用。 */
export async function uploadOpenAiCompatibleVideoFile(
  config: Pick<OpenAiTransportConfig, 'apiKey' | 'baseUrl'>,
  absolutePath: string,
): Promise<string> {
  const apiBase = normalizeOpenAiCompatibleApiBase(config.baseUrl);
  if (!apiBase) {
    throw new Error('Video upload requires baseUrl');
  }

  const metadata = await stat(absolutePath);
  const cacheKey = `${absolutePath}\0${metadata.mtimeMs}`;
  const cached = uploadCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const bytes = await readFile(absolutePath);
  const form = new FormData();
  form.append('file', new Blob([bytes]), basename(absolutePath));
  form.append('purpose', 'video');

  const response = await getLlmFetch()(`${apiBase}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Video upload failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== 'string' || payload.id.trim().length === 0) {
    throw new Error('Video upload returned no file id');
  }

  const url = `ms://${payload.id.trim()}`;
  uploadCache.set(cacheKey, url);
  return url;
}

export async function uploadMoonshotVideoFile(
  config: Pick<OpenAiTransportConfig, 'apiKey' | 'baseUrl'>,
  absolutePath: string,
): Promise<string> {
  return uploadOpenAiCompatibleVideoFile(
    { ...config, baseUrl: config.baseUrl ?? DEFAULT_MOONSHOT_BASE_URL },
    absolutePath,
  );
}

export function clearMoonshotVideoUploadCache(): void {
  uploadCache.clear();
}

export const clearOpenAiCompatibleVideoUploadCache = clearMoonshotVideoUploadCache;
