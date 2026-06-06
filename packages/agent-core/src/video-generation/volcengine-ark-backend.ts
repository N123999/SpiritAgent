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

interface VolcengineArkTaskCreateResponse {
  id?: string;
}

interface VolcengineArkTaskStatusResponse {
  status?: string;
  error?: { message?: string };
  content?: {
    video_url?: string;
  };
}

export class VolcengineArkVideoBackend implements VideoGenerationBackend {
  readonly id = 'volcengine-ark';

  async generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput> {
    const baseUrl = (config.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    const createUrl = `${baseUrl}/contents/generations/tasks`;

    console.error('[agent-core][generate-video] request.start', {
      adapter: this.id,
      model: config.model,
      baseUrl,
      createUrl,
      duration: request.duration,
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
    });

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        content: [{ type: 'text', text: request.prompt }],
        ...(request.duration !== undefined ? { duration: request.duration } : {}),
        ...(request.aspectRatio ? { ratio: request.aspectRatio } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`Volcengine Ark video task creation failed (${createResponse.status}): ${body}`);
    }

    const created = (await createResponse.json()) as VolcengineArkTaskCreateResponse;
    const taskId = created.id?.trim();
    if (!taskId) {
      throw new Error('Volcengine Ark video task creation returned no task id.');
    }

    const statusUrl = `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
    const completed = await pollUntil(async () => {
      const statusResponse = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });
      if (!statusResponse.ok) {
        const body = await statusResponse.text();
        throw new Error(`Volcengine Ark video task polling failed (${statusResponse.status}): ${body}`);
      }

      const status = (await statusResponse.json()) as VolcengineArkTaskStatusResponse;
      const state = status.status?.toLowerCase();
      if (state === 'succeeded') {
        return status;
      }
      if (state === 'failed' || state === 'cancelled' || state === 'canceled') {
        throw new Error(status.error?.message ?? `Volcengine Ark video task ended with status: ${status.status}`);
      }
      return undefined;
    });

    const videoUrl = completed.content?.video_url?.trim();
    if (!videoUrl) {
      throw new Error('Volcengine Ark video task succeeded without a video_url.');
    }

    const downloadResponse = await fetch(videoUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Failed to download Volcengine Ark video (${downloadResponse.status}).`);
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
      taskId,
      savedPath: saved.path,
      mimeType: saved.mimeType,
    });

    return buildGeneratedVideoToolOutput(saved, config, request);
  }
}
