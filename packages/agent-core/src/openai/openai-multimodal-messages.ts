import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import {
  cloneLlmProviderState,
  llmMessageHasMedia,
  llmMessageTextContent,
  type JsonObject,
  type JsonValue,
  type LlmMessage,
} from '../ports.js';
import { uploadOpenAiCompatibleVideoFile } from './moonshot-files.js';
import {
  pathToLocalVideoReference,
  resolveLocalMediaPath,
} from './openai-multimodal-media-path.js';
import {
  resolveOpenAiModelCompatibilityProfile,
  type OpenAiTransportConfig,
} from './openai-compat.js';

export function llmHistoryToOpenAiMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonValue[] {
  return history.map((message) => llmMessageToOpenAiMessage(message, assetRoot));
}

export function llmMessageToOpenAiMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    return {
      ...llmMessageProviderState(message),
      role: 'assistant',
      content: llmMessageTextContent(message.content),
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.argumentsJson,
        },
      })),
    };
  }

  if (message.role === 'user' && llmMessageHasMedia(message.content)) {
    const parts: JsonValue[] = [];

    for (const part of message.content) {
      if (part.type === 'text' && part.text.length > 0) {
        parts.push({ type: 'text', text: part.text });
        continue;
      }

      if (part.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: {
            url: pathToImageUrl(part.path, assetRoot),
          },
        });
        continue;
      }

      if (part.type === 'video') {
        parts.push({
          type: 'video_url',
          video_url: {
            url: pathToLocalVideoReference(part.path, assetRoot),
          },
        });
      }
    }

    if (parts.length === 0) {
      return { role: message.role, content: '' };
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  return {
    ...llmMessageProviderState(message),
    role: message.role,
    content: llmMessageTextContent(message.content),
    ...(message.toolCallId !== undefined ? { tool_call_id: message.toolCallId } : {}),
  };
}

/** Moonshot AI：将本地视频路径上传为 Files API（purpose=video），并改写为 ms:// 引用。 */
export async function resolveMoonshotVideoUrlsInOpenAiMessages(
  config: OpenAiTransportConfig,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (config.llmVendor !== 'moonshot-ai') {
    return;
  }

  const profile = resolveOpenAiModelCompatibilityProfile(config);
  if (!profile.capabilities.videoInput) {
    return;
  }

  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== 'user' || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (!isJsonObject(part) || part.type !== 'video_url') {
        continue;
      }

      const rawVideoUrl = part['video_url'];
      if (typeof rawVideoUrl !== 'object' || rawVideoUrl === null || Array.isArray(rawVideoUrl)) {
        continue;
      }

      const urlValue = rawVideoUrl['url'];
      if (typeof urlValue !== 'string') {
        continue;
      }

      const url = urlValue.trim();
      if (!needsMoonshotVideoUpload(url)) {
        continue;
      }

      const absolutePath = resolveLocalMediaPath(url, assetRoot);
      rawVideoUrl['url'] = await uploadOpenAiCompatibleVideoFile(config, absolutePath);
    }
  }
}

function needsMoonshotVideoUpload(url: string): boolean {
  return (
    url.length > 0
    && !url.startsWith('http://')
    && !url.startsWith('https://')
    && !url.startsWith('data:')
    && !url.startsWith('ms://')
  );
}

function pathToImageUrl(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('data:')
    || normalized.startsWith('file://')
  ) {
    return normalized;
  }

  const absolutePath = resolveLocalMediaPath(normalized, assetRoot);
  const mime = guessImageMimeFromPath(absolutePath);

  try {
    const bytes = readFileSync(absolutePath);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return toFileUrl(absolutePath);
  }
}

function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function guessImageMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

function llmMessageProviderState(message: LlmMessage): JsonObject {
  if (message.providerState === undefined) {
    return {};
  }

  return cloneLlmProviderState(message.providerState);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
