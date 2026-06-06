import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from '../ports.js';
import { AiSdkGatewayVideoBackend } from './ai-sdk-gateway-backend.js';
import { OpenRouterVideosBackend } from './openrouter-videos-backend.js';
import { VolcengineArkVideoBackend } from './volcengine-ark-backend.js';
import type { VideoGenerationBackend } from './types.js';

const volcengineArkBackend = new VolcengineArkVideoBackend();
const openRouterVideosBackend = new OpenRouterVideosBackend();
const aiSdkGatewayBackend = new AiSdkGatewayVideoBackend();

export function isVolcengineArkApiBase(baseUrl: string | undefined): boolean {
  if (!baseUrl) {
    return false;
  }

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname.includes('volces.com') || hostname.includes('bytepluses.com');
  } catch {
    return false;
  }
}

export function resolveVideoGenerationBackend(
  config: OpenAiVideoGenerationConfig,
): VideoGenerationBackend {
  if (config.llmVendor === 'vercel-ai-gateway') {
    return aiSdkGatewayBackend;
  }

  if (config.llmVendor === 'openrouter') {
    return openRouterVideosBackend;
  }

  if (isVolcengineArkApiBase(config.baseUrl)) {
    return volcengineArkBackend;
  }

  throw new Error(
    'No video generation backend is configured for the selected video model. Use Volcengine Ark, Vercel AI Gateway, or OpenRouter.',
  );
}

export async function generateVideoWithRouter(
  config: OpenAiVideoGenerationConfig,
  request: VideoGenerationRequest,
  saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
): Promise<ToolExecutionOutput> {
  const backend = resolveVideoGenerationBackend(config);
  try {
    return await backend.generate(config, request, saveGeneratedVideo);
  } catch (error) {
    console.error('[agent-core][generate-video] request.failed', {
      adapter: backend.id,
      model: config.model,
      baseUrl: config.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
