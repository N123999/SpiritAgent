import {
  tryExtractPartialJsonStringValue,
  tryExtractPartialPlanName,
} from './edit-file-line-delta.js';
import { monacoLanguageId } from './monaco-language.js';
import type { ToolBlockSnapshot } from '../types.js';

/** Host request uses `plan_name`; streaming / model JSON uses slug in `name`. */
function planSlugFromCreatePlanRecord(record: Record<string, unknown>): string | undefined {
  const planName = typeof record.plan_name === 'string' ? record.plan_name.trim() : '';
  if (planName) {
    return planName;
  }
  const streamedName = typeof record.name === 'string' ? record.name.trim() : '';
  if (!streamedName || streamedName === 'create_plan') {
    return undefined;
  }
  return streamedName;
}

export const FILE_DIFF_TOOL_NAMES = new Set([
  'create_file',
  'create_plan',
  'edit_file',
  'delete_file',
]);

/** 与 delete-file-line-delta / readWorkspaceTextFile 一致。 */
export const FILE_TOOL_DIFF_MAX_BYTES = 2 * 1024 * 1024;

/** 会话中持久化文件工具完整参数 JSON 的上限（约为两侧 diff 文本上限之和）。 */
export const FILE_TOOL_DIFF_ARGUMENTS_JSON_MAX_BYTES = 8 * 1024 * 1024;

export function serializeFileToolDiffArgumentsJson(request: unknown): string | undefined {
  const json = JSON.stringify(request);
  if (new TextEncoder().encode(json).length > FILE_TOOL_DIFF_ARGUMENTS_JSON_MAX_BYTES) {
    return undefined;
  }
  return json;
}

function fileToolDiffArgumentsJsonForTool(tool: ToolBlockSnapshot): string | undefined {
  if (tool.phase === 'preview') {
    return tool.streamingArgumentsJson;
  }
  return tool.fileToolDiffArgumentsJson ?? tool.streamingArgumentsJson;
}

/** 审批/执行阶段 upsert 时保留 preview 流式参数或既有完整 JSON，避免只剩截断 argsExcerpt。 */
export function preserveFileToolDiffArguments(
  toolName: string,
  attached: ToolBlockSnapshot,
  prior?: ToolBlockSnapshot,
): ToolBlockSnapshot {
  if (!FILE_DIFF_TOOL_NAMES.has(toolName)) {
    return attached;
  }
  if (attached.fileToolDiffArgumentsJson?.trim()) {
    return attached;
  }
  const fromPrior =
    prior?.fileToolDiffArgumentsJson?.trim() || prior?.streamingArgumentsJson?.trim();
  if (!fromPrior) {
    return attached;
  }
  return { ...attached, fileToolDiffArgumentsJson: fromPrior };
}

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
    fileToolDiffArgumentsJsonForTool(tool) ||
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
    const slug = planSlugFromCreatePlanRecord(record);
    return slug ? planRelativePath(slug) : undefined;
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

  const argumentsJson = fileToolDiffArgumentsJsonForTool(tool);

  if (argumentsJson?.trim()) {
    try {
      const parsed = JSON.parse(argumentsJson) as unknown;
      if (parsed && typeof parsed === 'object') {
        const fromComplete = resolveFromRecord(
          tool,
          parsed as Record<string, unknown>,
          options,
        );
        if (fromComplete !== undefined) {
          return fromComplete;
        }
      }
    } catch {
      // Incomplete streaming JSON — fall through to partial field extraction.
    }
  }

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

  if (
    tool.phase !== 'preview' &&
    !fileToolDiffArgumentsJsonForTool(tool)?.trim() &&
    tool.argsExcerpt &&
    argsExcerptLooksTruncated(tool.argsExcerpt)
  ) {
    return 'truncated';
  }

  return undefined;
}

export function isFileDiffTool(toolName: string): boolean {
  return FILE_DIFF_TOOL_NAMES.has(toolName);
}
