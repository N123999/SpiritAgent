import { getLlmFetch } from '../llm-fetch.js';
import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from '../ports.js';
import { buildGeneratedVideoToolOutput } from './output.js';
import { pollUntil } from './poll.js';
import type { VideoGenerationBackend } from './types.js';

interface SiliconFlowVideoSubmitResponse {
  requestId?: string;
}

interface SiliconFlowVideoStatusResponse {
  status?: string;
  reason?: string;
  results?: {
    videos?: Array<{ url?: string }>;
  };
}

export function mapSiliconFlowVideoImageSize(aspectRatio?: string): string {
  switch (aspectRatio?.trim()) {
    case '9:16':
      return '720x1280';
    case '1:1':
      return '960x960';
    case '16:9':
    default:
      return '1280x720';
  }
}

export class SiliconFlowVideoBackend implements VideoGenerationBackend {
  readonly id = 'siliconflow';

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const baseUrl = (config.baseUrl ?? 'https://api.siliconflow.com/v1').replace(/\/$/, '');
    const submitUrl = `${baseUrl}/video/submit`;
    const imageSize = mapSiliconFlowVideoImageSize(request.aspectRatio);

    console.error('[agent-core][generate-video] request.start', {
      adapter: this.id,
      model: config.model,
      baseUrl,
      submitUrl,
      aspectRatio: request.aspectRatio,
      imageSize,
    });

    const createResponse = await getLlmFetch()(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        image_size: imageSize,
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`SiliconFlow video submit failed (${createResponse.status}): ${body}`);
    }

    const created = (await createResponse.json()) as SiliconFlowVideoSubmitResponse;
    const requestId = created.requestId?.trim();
    if (!requestId) {
      throw new Error('SiliconFlow video submit returned no requestId.');
    }

    const statusUrl = `${baseUrl}/video/status`;
    const completed = await pollUntil(async () => {
      const statusResponse = await getLlmFetch()(statusUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      });
      if (!statusResponse.ok) {
        const body = await statusResponse.text();
        throw new Error(`SiliconFlow video status polling failed (${statusResponse.status}): ${body}`);
      }

      const status = (await statusResponse.json()) as SiliconFlowVideoStatusResponse;
      const state = status.status?.trim();
      if (state === 'Succeed') {
        return status;
      }
      if (state === 'Failed') {
        throw new Error(status.reason ?? 'SiliconFlow video generation failed.');
      }
      return undefined;
    });

    const videoUrl = completed.results?.videos?.[0]?.url?.trim();
    if (!videoUrl) {
      throw new Error('SiliconFlow video generation succeeded without a video URL.');
    }

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      const body = await downloadResponse.text();
      throw new Error(`SiliconFlow video download failed (${downloadResponse.status}): ${body}`);
    }

    const mediaType = downloadResponse.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4';
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
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
