import {
  isSkillMarkdownPath,
  readFileToolDisplayBase,
  skillFolderBasename,
} from '@spirit-agent/host-internal/skill-paths';

import type { ToolBlockSnapshot } from '../types.js';

export { isSkillMarkdownPath, skillFolderBasename } from '@spirit-agent/host-internal/skill-paths';

export const LEGACY_READ_FILE_HEADLINE =
  /^(?:查看|使用|View(?:ing|ed)?|Read(?:ing|ed)?|Us(?:ing|ed)?)\u002e?\s+(.+)$/u;

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

export function readFileVerbKey(path: string): 'tool.use' | 'tool.read' {
  return isSkillMarkdownPath(path) ? 'tool.use' : 'tool.read';
}

export function readFileDisplayBase(path: string, emptyLabel: string): string {
  return readFileToolDisplayBase(path, emptyLabel);
}

export function readFileHeadlineDetailForPath(
  rawPath: string,
  options: {
    emptyFileLabel: string;
    lineRange?: string;
  },
): string {
  const lineRange = options.lineRange ?? '';
  const base = isSkillMarkdownPath(rawPath)
    ? skillFolderBasename(rawPath)
    : readFileToolDisplayBase(rawPath, options.emptyFileLabel);
  return `${base}${lineRange}`.trim();
}

function positiveLineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function lineRangeForReadFile(startLine: unknown, endLine: unknown): string {
  const start = positiveLineNumber(startLine);
  const end = positiveLineNumber(endLine);
  if (start !== undefined && end !== undefined) {
    return ` ${start} - ${end}`;
  }
  if (start !== undefined) {
    return ` ${start} -`;
  }
  if (end !== undefined) {
    return ` 1 - ${end}`;
  }
  return '';
}

export function parseReadFileRequestRecordFromArgsExcerpt(
  argsExcerpt: string | undefined,
): Record<string, unknown> | undefined {
  const excerpt = argsExcerpt?.trim();
  if (!excerpt) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(excerpt) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const STORED_READ_FILE_USE_HEADLINES = new Set([
  '使用',
  'Use',
  'Using',
  'Used',
]);

export function storedReadFileHeadlineUsesSkillVerb(headline: string): boolean {
  return STORED_READ_FILE_USE_HEADLINES.has(headline.trim());
}
