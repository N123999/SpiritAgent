/**
 * Google Vertex AI 模型目录：`publishers/google/models`（需 OAuth）。
 * Express API Key 模式无法列模型，请手动填写部署名。
 */

import { GoogleAuth } from 'google-auth-library';

import type { ProviderListedModelEntry } from './openai-models.js';
import {
  normalizeVertexLocation,
  normalizeVertexProject,
  vertexPublisherModelsListUrl,
} from './google-vertex-endpoints.js';

export interface ListVertexModelsOptions {
  project: string;
  location: string;
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  signal?: AbortSignal;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function vertexModelIdFromPublisherName(name: string): string | undefined {
  const trimmed = name.trim();
  const marker = '/models/';
  const index = trimmed.lastIndexOf(marker);
  if (index >= 0) {
    const id = trimmed.slice(index + marker.length).trim();
    return id.length > 0 ? id : undefined;
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function vertexModelSupportsReasoning(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized.includes('gemini-2.5') || normalized.includes('gemini-3');
}

/** 解析 Vertex `publisherModels` 列表响应。 */
export function parseVertexModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }

  const publisherModels = (body as { publisherModels?: unknown }).publisherModels;
  if (!Array.isArray(publisherModels)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of publisherModels) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = readOptionalTrimmedString(record.name);
    if (!name) {
      continue;
    }

    const id = vertexModelIdFromPublisherName(name);
    if (!id) {
      continue;
    }

    const displayName = readOptionalTrimmedString(record.displayName);
    const description = readOptionalTrimmedString(record.description);
    const inputLimit = typeof record.inputTokenLimit === 'number' && record.inputTokenLimit > 0
      ? record.inputTokenLimit
      : undefined;
    const outputLimit = typeof record.outputTokenLimit === 'number' && record.outputTokenLimit > 0
      ? record.outputTokenLimit
      : undefined;

    entries.push({
      id,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      ...(inputLimit !== undefined && outputLimit !== undefined
        ? { contextLength: inputLimit + outputLimit }
        : {}),
      supportsReasoning: vertexModelSupportsReasoning(id),
    });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

async function resolveVertexAccessToken(options: ListVertexModelsOptions): Promise<string> {
  const clientEmail = options.vertexClientEmail?.trim();
  const privateKey = options.vertexPrivateKey?.trim();
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(clientEmail && privateKey
      ? {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, '\n'),
          },
        }
      : {}),
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token?.trim();
  if (!token) {
    throw new Error('无法获取 Google Vertex 访问令牌。请检查 ADC 或服务账号凭证。');
  }
  return token;
}

async function fetchVertexModelsPage(
  url: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    ...(signal ? { signal } : {}),
  });

  const text = await response.text();
  let json: unknown = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`列模型失败（HTTP ${String(response.status)}）：响应不是有效 JSON。`);
    }
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

  return json;
}

export async function listVertexModels(
  options: ListVertexModelsOptions,
): Promise<ProviderListedModelEntry[]> {
  if (options.apiKey?.trim()) {
    throw new Error('Google Vertex Express API Key 模式无法自动列模型，请手动填写模型 ID。');
  }

  const project = normalizeVertexProject(options.project);
  const location = normalizeVertexLocation(options.location);
  if (!project) {
    throw new Error('Google Vertex 列模型需要填写 GCP 项目 ID。');
  }
  if (!location) {
    throw new Error('Google Vertex 列模型需要填写区域（location）。');
  }

  const accessToken = await resolveVertexAccessToken(options);
  const allEntries: ProviderListedModelEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = vertexPublisherModelsListUrl(project, location, pageToken);
    const json = await fetchVertexModelsPage(url, accessToken, options.signal);
    allEntries.push(...parseVertexModelEntriesPayload(json));

    pageToken =
      typeof json === 'object' && json !== null && 'nextPageToken' in json
        ? readOptionalTrimmedString((json as { nextPageToken?: unknown }).nextPageToken)
        : undefined;
  } while (pageToken);

  const seen = new Set<string>();
  return allEntries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}
