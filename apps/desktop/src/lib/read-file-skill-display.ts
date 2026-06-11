import { SKILL_FILE_NAME } from '@spirit-agent/host-internal/storage';

import type { ToolBlockSnapshot } from '../types.js';

export const LEGACY_READ_FILE_HEADLINE =
  /^(?:查看|使用|View(?:ing|ed)?|Us(?:ing|ed)?)\u002e?\s+(.+)$/u;

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean);
}

function pathBasename(path: string): string {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    return normalizePath(path);
  }
  return segments[segments.length - 1] ?? normalizePath(path);
}

export function isSkillMarkdownPath(path: string): boolean {
  return pathBasename(path) === SKILL_FILE_NAME;
}

export function skillFolderBasename(path: string): string {
  const segments = pathSegments(path);
  if (segments.length < 2) {
    return pathBasename(path);
  }
  return segments[segments.length - 2] ?? pathBasename(path);
}

export function parseReadFilePathFromRequest(request: unknown): string {
  if (!request || typeof request !== 'object') {
    return '';
  }
  const record = request as Record<string, unknown>;
  if (typeof record.path === 'string') {
    return record.path;
  }
  if (typeof record.filePath === 'string') {
    return record.filePath;
  }
  return '';
}

export function parseReadFilePathFromToolSnapshot(
  tool: Pick<ToolBlockSnapshot, 'argsExcerpt' | 'headline' | 'detailLines'>,
): string {
  const excerpt = tool.argsExcerpt?.trim();
  if (excerpt) {
    try {
      const parsed = JSON.parse(excerpt) as { path?: unknown; filePath?: unknown };
      if (typeof parsed.path === 'string') {
        return parsed.path;
      }
      if (typeof parsed.filePath === 'string') {
        return parsed.filePath;
      }
    } catch {
      // argsExcerpt may be truncated or non-JSON during streaming
    }
  }

  const legacy = LEGACY_READ_FILE_HEADLINE.exec(tool.headline.trim());
  if (legacy?.[1]) {
    return legacy[1].trim();
  }

  return '';
}

export function readFileVerbKey(path: string): 'tool.use' | 'tool.view' {
  return isSkillMarkdownPath(path) ? 'tool.use' : 'tool.view';
}
