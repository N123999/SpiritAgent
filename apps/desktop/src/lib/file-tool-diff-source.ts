import {
  tryExtractPartialJsonStringValue,
  tryExtractPartialPlanName,
} from './edit-file-line-delta.js';
import { monacoLanguageId } from './monaco-language.js';
import type { ToolBlockSnapshot } from '../types.js';

export const FILE_DIFF_TOOL_NAMES = new Set([
  'create_file',
  'create_plan',
  'edit_file',
  'delete_file',
]);

/** 与 delete-file-line-delta / readWorkspaceTextFile 一致。 */
export const FILE_TOOL_DIFF_MAX_BYTES = 2 * 1024 * 1024;

export type FileToolDiffSource = {
  relativePath: string;
  languageId: string;
  original: string;
  modified: string;
};

export type FileToolDiffResolveResult =
  | FileToolDiffSource
  | 'truncated'
  | 'too-large'
  | undefined;

export type ResolveFileToolDiffOptions = {
  open: boolean;
  workspaceRoot?: string;
  planBaselineText?: string;
};

function textExceedsDiffLimit(text: string): boolean {
  return new TextEncoder().encode(text).length > FILE_TOOL_DIFF_MAX_BYTES;
}

export function planRelativePath(planName: string): string {
  const slug = planName.trim();
  return `plans/${slug}.md`;
}

/** 从工具快照或流式 JSON 解析 create_plan 的 plans/{name}.md 路径。 */
export function resolvePlanRelativePath(
  tool: ToolBlockSnapshot,
  argumentsJson?: string,
): string | undefined {
  if (tool.toolName !== 'create_plan') {
    return undefined;
  }
  const json =
    argumentsJson?.trim() ||
    (tool.phase === 'preview' ? tool.streamingArgumentsJson : undefined) ||
    tool.argsExcerpt;
  if (!json?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object') {
      const name = (parsed as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) {
        return planRelativePath(name);
      }
    }
  } catch {
    const name = tryExtractPartialPlanName(json);
    if (name) {
      return planRelativePath(name);
    }
  }
  return undefined;
}

function extractPathFromRequest(
  toolName: string,
  record: Record<string, unknown>,
): string | undefined {
  if (toolName === 'create_plan') {
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    return name ? planRelativePath(name) : undefined;
  }
  const pathValue = record.path;
  return typeof pathValue === 'string' && pathValue.trim() ? pathValue.trim() : undefined;
}

function parseRequestRecord(
  tool: ToolBlockSnapshot,
  argumentsJson?: string,
): Record<string, unknown> | undefined {
  if (argumentsJson?.trim()) {
    try {
      const parsed = JSON.parse(argumentsJson) as unknown;
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return parsePartialRequestRecord(tool.toolName, argumentsJson);
    }
  }

  const excerpt = tool.argsExcerpt?.trim();
  if (!excerpt) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(excerpt) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function parsePartialRequestRecord(
  toolName: string,
  argumentsJson: string,
): Record<string, unknown> | undefined {
  if (toolName === 'create_plan') {
    const name = tryExtractPartialPlanName(argumentsJson);
    return name ? { name, content: tryExtractPartialJsonStringValue(argumentsJson, 'content') ?? '' } : undefined;
  }

  const path = tryExtractPartialJsonStringValue(argumentsJson, 'path');
  if (!path) {
    return undefined;
  }

  if (toolName === 'create_file') {
    const content = tryExtractPartialJsonStringValue(argumentsJson, 'content');
    return { path, ...(content !== undefined ? { content } : {}) };
  }

  if (toolName === 'edit_file') {
    const oldText = tryExtractPartialJsonStringValue(argumentsJson, 'old_text');
    const newText = tryExtractPartialJsonStringValue(argumentsJson, 'new_text');
    return {
      path,
      ...(oldText !== undefined ? { old_text: oldText } : {}),
      ...(newText !== undefined ? { new_text: newText } : {}),
    };
  }

  if (toolName === 'delete_file') {
    return { path };
  }

  return undefined;
}

function resolveFromRecord(
  tool: ToolBlockSnapshot,
  record: Record<string, unknown>,
  options: ResolveFileToolDiffOptions,
): FileToolDiffResolveResult {
  const relativePath = extractPathFromRequest(tool.toolName, record);
  if (!relativePath) {
    return undefined;
  }

  if (tool.toolName === 'delete_file') {
    const original = tool.deleteFileBaselineText ?? '';
    if (textExceedsDiffLimit(original)) {
      return 'too-large';
    }
    return {
      relativePath,
      languageId: monacoLanguageId(relativePath),
      original,
      modified: '',
    };
  }

  if (tool.toolName === 'create_file' || tool.toolName === 'create_plan') {
    const content = typeof record.content === 'string' ? record.content : '';
    const original =
      tool.toolName === 'create_plan' && options.planBaselineText !== undefined
        ? options.planBaselineText
        : '';
    if (textExceedsDiffLimit(content) || textExceedsDiffLimit(original)) {
      return 'too-large';
    }
    if (!content && !original) {
      return undefined;
    }
    return {
      relativePath,
      languageId: monacoLanguageId(relativePath),
      original,
      modified: content,
    };
  }

  const oldText = typeof record.old_text === 'string' ? record.old_text : '';
  const newText = typeof record.new_text === 'string' ? record.new_text : '';
  if (textExceedsDiffLimit(oldText) || textExceedsDiffLimit(newText)) {
    return 'too-large';
  }
  if (!oldText && !newText) {
    return undefined;
  }
  return {
    relativePath,
    languageId: monacoLanguageId(relativePath),
    original: oldText,
    modified: newText,
  };
}

function argsExcerptLooksTruncated(excerpt: string): boolean {
  const trimmed = excerpt.trim();
  if (!trimmed) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return false;
  } catch {
    return true;
  }
}

export function resolveFileToolDiffSource(
  tool: ToolBlockSnapshot,
  options: ResolveFileToolDiffOptions,
): FileToolDiffResolveResult {
  if (!FILE_DIFF_TOOL_NAMES.has(tool.toolName) || !options.open) {
    return undefined;
  }

  const argumentsJson =
    tool.phase === 'preview' ? tool.streamingArgumentsJson : undefined;

  const partial = argumentsJson
    ? parsePartialRequestRecord(tool.toolName, argumentsJson)
    : undefined;
  if (partial) {
    return resolveFromRecord(tool, partial, options);
  }

  const fromExcerpt = parseRequestRecord(tool, argumentsJson);
  if (fromExcerpt) {
    return resolveFromRecord(tool, fromExcerpt, options);
  }

  if (tool.toolName === 'delete_file' && tool.deleteFileBaselineText !== undefined) {
    const pathFromExcerpt = tryExtractPartialJsonStringValue(tool.argsExcerpt ?? '', 'path');
    const pathFromStream = argumentsJson
      ? tryExtractPartialJsonStringValue(argumentsJson, 'path')
      : undefined;
    const pathValue = pathFromStream ?? pathFromExcerpt ?? 'file';
    return resolveFromRecord(tool, { path: pathValue }, options);
  }

  if (tool.phase !== 'preview' && tool.argsExcerpt && argsExcerptLooksTruncated(tool.argsExcerpt)) {
    return 'truncated';
  }

  return undefined;
}

export function isFileDiffTool(toolName: string): boolean {
  return FILE_DIFF_TOOL_NAMES.has(toolName);
}
