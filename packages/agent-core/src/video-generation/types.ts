import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';
import type {
  GeneratedVideoFile,
  GeneratedVideoSaveRequest,
  ToolExecutionOutput,
  VideoGenerationRequest,
} from '../ports.js';

export interface VideoGenerationBackend {
  readonly id: string;
  generate(
    config: OpenAiVideoGenerationConfig,
    request: VideoGenerationRequest,
    saveGeneratedVideo: (request: GeneratedVideoSaveRequest) => Promise<GeneratedVideoFile>,
  ): Promise<ToolExecutionOutput>;
}
