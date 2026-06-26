import type { JsonObject, JsonValue } from '../ports.js';
import type { AnthropicTransportConfig } from '../anthropic/anthropic-compat.js';
import { isMinimaxAnthropicConfig } from '../anthropic/minimax-multimodal.js';
import { isMinimaxM3ThinkingSwitchModel } from './gateway-minimax-thinking.js';
import { uploadMinimaxVideoFile } from './minimax-files.js';
import type { OpenAiTransportConfig } from './openai-compat.js';
import { resolveOpenAiModelCompatibilityProfile } from './openai-compat.js';
import { resolveLocalMediaPath } from './openai-multimodal-media-path.js';

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function needsMinimaxVideoUpload(url: string): boolean {
  return (
    url.length > 0
    && !url.startsWith('http://')
    && !url.startsWith('https://')
    && !url.startsWith('data:')
    && !url.startsWith('mm_file://')
  );
}

async function resolveMinimaxVideoUrlsInMessages(
  config: Pick<OpenAiTransportConfig, 'apiKey' | 'baseUrl'>,
  messages: JsonValue[],
  assetRoot: string,
): Promise<void> {
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
      if (!needsMinimaxVideoUpload(url)) {
        continue;
      }

      const absolutePath = resolveLocalMediaPath(url, assetRoot);
      rawVideoUrl['url'] = await uploadMinimaxVideoFile(config, absolutePath);
    }
  }
}

/** MiniMax Anthropic Messages API：本地视频上传为 mm_file:// 引用。 */
export async function resolveMinimaxVideoInAnthropicMessages(
  config: Pick<AnthropicTransportConfig, 'apiKey' | 'baseUrl' | 'model' | 'modelCapabilities'>,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (!isMinimaxAnthropicConfig(config)) {
    return;
  }

  if (!config.modelCapabilities?.videoInput) {
    return;
  }

  if (!isMinimaxM3ThinkingSwitchModel(config.model)) {
    return;
  }

  await resolveMinimaxVideoUrlsInMessages(config, messages, assetRoot);
}

/** MiniMax OpenAI-compatible Chat Completions：本地视频上传为 mm_file:// 引用。 */
export async function resolveMinimaxVideoUrlsInOpenAiMessages(
  config: OpenAiTransportConfig,
  messages: JsonValue[],
  assetRoot = process.cwd(),
): Promise<void> {
  if (config.llmVendor !== 'minimax') {
    return;
  }

  const profile = resolveOpenAiModelCompatibilityProfile(config);
  if (!profile.capabilities.videoInput) {
    return;
  }

  if (!isMinimaxM3ThinkingSwitchModel(config.model)) {
    return;
  }

  await resolveMinimaxVideoUrlsInMessages(config, messages, assetRoot);
}
