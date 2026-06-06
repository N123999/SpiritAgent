import { createGateway, type GatewayVideoModelId } from '@ai-sdk/gateway';
import { experimental_generateVideo as generateVideo } from 'ai';

import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';
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
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });

    console.error('[agent-core][generate-video] request.start', {
      adapter: this.id,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    const result = await generateVideo({
      model: provider.videoModel(config.model as GatewayVideoModelId),
      prompt: request.prompt,
      duration: request.duration ?? DEFAULT_VIDEO_GENERATION_DURATION,
      ...(request.aspectRatio
        ? { aspectRatio: request.aspectRatio as `${number}:${number}` }
        : {}),
      ...(request.resolution
        ? { resolution: request.resolution as `${number}x${number}` }
        : {}),
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
