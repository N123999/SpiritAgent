import { createGateway, type GatewayVideoModelId } from '@ai-sdk/gateway';
import { experimental_generateVideo as generateVideo } from 'ai';

import { getLlmFetch } from '../llm-fetch.js';
import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';

/** Gateway 视频走 v3 AI 协议（默认 `…/v3/ai/video-model`），不能用 chat 预设的 `/v1` baseUrl。 */
export function resolveAiGatewayVideoProviderOptions(
  config: Pick<OpenAiVideoGenerationConfig, 'apiKey' | 'baseUrl'>,
): { apiKey: string } {
  return { apiKey: config.apiKey };
}
import {
  DEFAULT_VIDEO_GENERATION_DURATION,
  type GeneratedVideoFile,
  type GeneratedVideoSaveRequest,
  type ToolExecutionOutput,
  type VideoGenerationRequest,
} from '../ports.js';
import { buildGeneratedVideoToolOutput } from './output.js';
import type { VideoGenerationBackend } from './types.js';

export class AiSdkGatewayVideoBackend implements VideoGenerationBackend {
  readonly id = 'ai-sdk-gateway';

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const provider = createGateway({
      ...resolveAiGatewayVideoProviderOptions(config),
      fetch: getLlmFetch(),
    });

    console.error('[agent-core][generate-video] request.start', {
      adapter: this.id,
      model: config.model,
      gatewayBaseUrl: 'https://ai-gateway.vercel.sh/v3/ai',
      profileBaseUrl: config.baseUrl,
    });

    const result = await generateVideo({
      model: provider.video(config.model as GatewayVideoModelId),
      prompt: request.prompt,
      duration: request.duration ?? DEFAULT_VIDEO_GENERATION_DURATION,
      ...(request.aspectRatio
        ? { aspectRatio: request.aspectRatio as `${number}:${number}` }
        : {}),
      // Gateway Seedance 使用 720p/1080p 等标签，SDK 类型仍写 WxH。
      ...(request.resolution ? { resolution: request.resolution as never } : {}),
      maxRetries: 0,
    });

    const video = result.videos[0];
    if (!video) {
      throw new Error('AI Gateway video generation returned no video.');
    }

    const saved = await saveGeneratedVideo({
      data: video.uint8Array,
      mediaType: video.mediaType,
      prompt: request.prompt,
      model: config.model,
    });

    console.error('[agent-core][generate-video] request.success', {
      adapter: this.id,
      model: config.model,
      savedPath: saved.path,
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
