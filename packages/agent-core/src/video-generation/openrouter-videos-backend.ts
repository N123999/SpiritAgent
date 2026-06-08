import { getLlmFetch } from '../llm-fetch.js';
import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from '../ports.js';
import { pollUntil } from './poll.js';
import { buildGeneratedVideoToolOutput } from './output.js';
import type { VideoGenerationBackend } from './types.js';

interface OpenRouterVideoCreateResponse {
  id?: string;
  polling_url?: string;
}

interface OpenRouterVideoStatusResponse {
  status?: string;
  error?: string | { message?: string };
  unsigned_urls?: string[];
}

export class OpenRouterVideosBackend implements VideoGenerationBackend {
  readonly id = 'openrouter-videos';

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const createUrl = `${baseUrl}/videos`;

    console.error('[agent-core][generate-video] request.start', {
      adapter: this.id,
      model: config.model,
      baseUrl,
      createUrl,
    });

    const createResponse = await getLlmFetch()(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        ...(request.duration !== undefined ? { duration: request.duration } : {}),
        ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`OpenRouter video task creation failed (${createResponse.status}): ${body}`);
    }

    const created = (await createResponse.json()) as OpenRouterVideoCreateResponse;
    const pollingUrl = created.polling_url?.trim();
    if (!pollingUrl) {
      throw new Error('OpenRouter video task creation returned no polling_url.');
    }

    const completed = await pollUntil(async () => {
      const statusResponse = await getLlmFetch()(pollingUrl, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });
      if (!statusResponse.ok) {
        const body = await statusResponse.text();
        throw new Error(`OpenRouter video task polling failed (${statusResponse.status}): ${body}`);
      }

      const status = (await statusResponse.json()) as OpenRouterVideoStatusResponse;
      const state = status.status?.toLowerCase();
      if (state === 'completed') {
        return status;
      }
      if (state === 'failed' || state === 'error') {
        const message = typeof status.error === 'string'
          ? status.error
          : status.error?.message;
        throw new Error(message ?? `OpenRouter video task ended with status: ${status.status}`);
      }
      return undefined;
    });

    const videoUrl = completed.unsigned_urls?.find((entry) => entry.trim().length > 0)?.trim();
    if (!videoUrl) {
      throw new Error('OpenRouter video task completed without a downloadable video URL.');
    }

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download OpenRouter video (${downloadResponse.status}).`);
    }

    const mediaType = downloadResponse.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'video/mp4';
    const data = new Uint8Array(await downloadResponse.arrayBuffer());
    const saved = await saveGeneratedVideo({
      data,
      mediaType,
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
