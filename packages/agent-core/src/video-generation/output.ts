import {
  createLlmMessageContentFromTextAndImages,
  type GeneratedVideoFile,
  type ToolExecutionOutput,
  type VideoGenerationRequest,
} from '../ports.js';
import type { OpenAiVideoGenerationConfig } from '../openai/openai-compat.js';

export function normalizeGeneratedVideoMarkdownRef(markdownRef: string): string {
  const trimmed = markdownRef.trim();
  if (!trimmed) {
    throw new Error('Host returned an empty generated video markdownRef.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Host returned an invalid generated video markdownRef.');
  }

  if (
    url.protocol.toLowerCase() !== 'spirit-agent:' ||
    url.hostname.toLowerCase() !== 'generated' ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('Host returned an invalid generated video markdownRef.');
  }

  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== 'video') {
    throw new Error('Host returned an invalid generated video markdownRef.');
  }

  let videoId: string;
  try {
    videoId = decodeURIComponent(segments[1] ?? '').trim();
  } catch {
    throw new Error('Host returned an invalid generated video markdownRef.');
  }

  if (
    !videoId ||
    videoId.includes('/') ||
    videoId.includes('\\') ||
    videoId === '.' ||
    videoId === '..'
  ) {
    throw new Error('Host returned an invalid generated video markdownRef.');
  }

  return `spirit-agent://generated/video/${encodeURIComponent(videoId)}`;
}

export function buildGeneratedVideoToolOutput(
  saved: GeneratedVideoFile,
  config: OpenAiVideoGenerationConfig,
  request: VideoGenerationRequest,
): ToolExecutionOutput {
  const summaryLines = ['[generated video]'];
  const markdownRef = normalizeGeneratedVideoMarkdownRef(saved.markdownRef);
  summaryLines.push(
    `video_ref: ${markdownRef}`,
    `read_file_path: ${markdownRef}`,
    `embed_markdown: <video src="${markdownRef}" controls></video>`,
  );
  summaryLines.push(`mime_type: ${saved.mimeType}`, `model: ${config.model}`);
  if (request.duration !== undefined) {
    summaryLines.push(`duration: ${request.duration}`);
  }
  if (request.aspectRatio) {
    summaryLines.push(`aspect_ratio: ${request.aspectRatio}`);
  }
  if (request.resolution) {
    summaryLines.push(`resolution: ${request.resolution}`);
  }
  const summaryText = summaryLines.join('\n');

  return {
    content: createLlmMessageContentFromTextAndImages(summaryText, [], [saved.path]),
    summaryText,
  };
}
