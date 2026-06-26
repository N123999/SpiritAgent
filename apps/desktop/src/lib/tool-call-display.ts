import { FILE_DIFF_TOOL_NAMES } from '@/lib/file-tool-diff-source.js';
import i18n from '@/lib/i18n';
import {
  parseShellToolCommand,
  shellExpandableDetailLines,
  shellHasExpandableContent,
} from '@/lib/shell-tool-display';
import {
  isSkillMarkdownPath,
  LEGACY_READ_FILE_HEADLINE,
  lineRangeForReadFile,
  parseReadFilePathFromToolSnapshot,
  parseReadFileRequestRecordFromArgsExcerpt,
  storedReadFileHeadlineUsesSkillVerb,
} from '@/lib/read-file-skill-display';
import {
  readFileToolHeadlineDetail,
  readFileVerbKey,
} from '@/lib/read-file-tool-display';
import { phaseToVerbContext } from '@/lib/tool-verb-context';
import { grepToolHeadlineDetail, parseGrepRequestFromArgsExcerpt } from '@/lib/grep-tool-display';
import { resolveTodoWriteBeforeSnapshot, todoWriteSummaryDetail } from '@/lib/todo-tool-display.js';
import type { ToolBlockSnapshot } from '@/types';

export type ShellToolSummaryParts = {
  verb: string;
  reason: string;
};

export type ToolCallSummaryParts = {
  headline: string;
  detail?: string;
  /** When set, headline is split into verb (darkest) + reason (mid) for shell. */
  shellSummary?: ShellToolSummaryParts;
};

export { toolCallPhaseShowsShimmer } from './tool-call-shimmer.js';

const RESPONSES_BUILT_IN_TOOL_NAMES = new Set([
  'web_search',
  'code_interpreter',
]);

/**
 * Direct mapping from toolName to i18n verb key.
 * Used by the renderer to re-translate headlines at render time so that
 * switching the UI language instantly updates all tool cards.
 */
const TOOL_VERB_KEY_MAP: Record<string, string> = {
  create_file: 'tool.create',
  edit_file: 'tool.edit',
  delete_file: 'tool.delete',
  grep: 'tool.search',
  glob: 'tool.match',
  web_fetch: 'tool.fetch',
  web_search: 'tool.webSearch',
  code_interpreter: 'tool.codeInterpreter',
  list_directory_files: 'tool.listDirectory',
  ask_questions: 'tool.askQuestions',
  run_subagent: 'tool.subagent',
  dream_list: 'tool.dreamList',
  dream_read: 'tool.dreamRead',
  dream_update: 'tool.dreamUpdate',
  dream_delete: 'tool.dreamDelete',
  dream_record: 'tool.dreamRecord',
  todo_write: 'tool.todoWrite',
  todo_list: 'tool.todoList',
  tool_call: 'tool.lazyToolCall',
  tool_describe: 'tool.lazyToolDescribe',
  create_plan: 'tool.create',
  create_automation: 'automations.create',
};

/**
 * All known locale variants of the "runCommand" key (base + context suffixes).
 * Used to detect whether a stored headline is the default translation (from
 * any locale) vs a custom model-supplied reason.
 */
const RUN_COMMAND_DEFAULT_HEADLINES = new Set([
  // zh-CN (base key; no _running/_succeeded variants → same value)
  '运行命令',
  // en base + context variants
  'Run command',
  'Running command',
  'Ran command',
]);

/** Reverse-map an apply_patch headline back to its verb key. */
const APPLY_PATCH_VERB_VARIANTS: ReadonlyArray<{ key: string; values: Set<string> }> = [
  { key: 'tool.create', values: new Set(['创建', 'Create', 'Creating', 'Created']) },
  { key: 'tool.edit', values: new Set(['编辑', 'Edit', 'Editing', 'Edited']) },
  { key: 'tool.delete', values: new Set(['删除', 'Delete', 'Deleting', 'Deleted']) },
];

function shellToolSummaryFromReason(
  reason: string,
  phase: ToolBlockSnapshot['phase'],
): Pick<ToolCallSummaryParts, 'headline' | 'shellSummary'> {
  const trimmed = reason.trim();
  const ctx = phaseToVerbContext(phase);
  const tOpts = ctx ? { context: ctx } : {};
  const defaultHeadline = i18n.t('tool.runCommand', tOpts);
  if (!trimmed || RUN_COMMAND_DEFAULT_HEADLINES.has(trimmed)) {
    return { headline: defaultHeadline };
  }
  const verb = i18n.t('tool.runShellVerb', tOpts);
  return {
    headline: `${verb} ${trimmed}`,
    shellSummary: { verb, reason: trimmed },
  };
}

export function isResponsesBuiltInToolCard(toolName: string): boolean {
  return RESPONSES_BUILT_IN_TOOL_NAMES.has(toolName);
}

function countDiagnosticsIssues(outputExcerpt: string | undefined): number {
  if (!outputExcerpt) {
    return 0;
  }
  // 优先从 header 解析真实总数，避免 maxItems 截断导致低估：
  // "Diagnostics for src/x.ts (8 shown, 7 more omitted):" → 15
  const headerPattern = /^Diagnostics for .+?\((\d+) shown(?:,\s*(\d+) more omitted)?\):/gm;
  let total = 0;
  let headerCount = 0;
  let match: RegExpExecArray | null;
  while ((match = headerPattern.exec(outputExcerpt)) !== null) {
    headerCount += 1;
    total += (Number(match[1]) || 0) + (Number(match[2]) || 0);
  }
  if (headerCount > 0) {
    return total;
  }
  // 兜底：按行统计（无 header 时）
  return outputExcerpt
    .split('\n')
    .filter((line) => /^(error|warning)\s/.test(line.trim()))
    .length;
}

function diagnosticsOutputIsAllClean(output: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) {
    return true;
  }
  const sections = trimmed.split(/\n\n+/).map((section) => section.trim()).filter(Boolean);
  return sections.every((section) => section.startsWith('No errors or warnings'));
}

function readFileToolSummaryParts(tool: ToolBlockSnapshot): ToolCallSummaryParts {
  const ctx = phaseToVerbContext(tool.phase);
  const tOpts = ctx ? { context: ctx } : {};
  const snapshotDetail = tool.headlineDetail?.trim();
  const rawPath = parseReadFilePathFromToolSnapshot(tool);

  if (rawPath) {
    const argsRecord = parseReadFileRequestRecordFromArgsExcerpt(tool.argsExcerpt);
    const lineRange = argsRecord
      ? lineRangeForReadFile(argsRecord.offset, argsRecord.limit)
      : '';
    const isSkillPath = isSkillMarkdownPath(rawPath);
    const skillMarkdownContent = isSkillPath ? tool.outputExcerpt : undefined;
    const computedDetail = readFileToolHeadlineDetail(rawPath, {
      emptyFileLabel: i18n.t('tool.file'),
      toolOutputLabel: i18n.t('tool.toolOutput'),
      lineRange,
      skillMarkdownContent,
    }).trim();
    const detail = isSkillPath
      ? (computedDetail || undefined)
      : (computedDetail || snapshotDetail || undefined);
    return {
      headline: i18n.t(readFileVerbKey(rawPath), tOpts),
      ...(detail ? { detail } : {}),
    };
  }

  if (!snapshotDetail) {
    const legacy = LEGACY_READ_FILE_HEADLINE.exec(tool.headline.trim());
    if (legacy) {
      const legacyPath = legacy[1].trim();
      const legacyDetail = readFileToolHeadlineDetail(legacyPath, {
        emptyFileLabel: i18n.t('tool.file'),
        toolOutputLabel: i18n.t('tool.toolOutput'),
      }).trim();
      return {
        headline: i18n.t(readFileVerbKey(legacyPath), tOpts),
        ...(legacyDetail ? { detail: legacyDetail } : {}),
      };
    }
  }

  const verbKey = storedReadFileHeadlineUsesSkillVerb(tool.headline)
    ? 'tool.use'
    : 'tool.read';
  return {
    headline: i18n.t(verbKey, tOpts),
    ...(snapshotDetail ? { detail: snapshotDetail } : {}),
  };
}

export function getToolCallSummaryParts(tool: ToolBlockSnapshot): ToolCallSummaryParts {
  const headline = tool.headline.trim();
  const snapshotDetail = tool.headlineDetail?.trim();

  if (tool.toolName === 'read_file') {
    return readFileToolSummaryParts(tool);
  }

  if (tool.toolName === 'shell') {
    const command = snapshotDetail || parseShellToolCommand(tool);
    return {
      ...shellToolSummaryFromReason(headline, tool.phase),
      ...(command ? { detail: command } : {}),
    };
  }

  if (tool.toolName === 'get_diagnostics') {
    if (
      tool.phase === 'preview' ||
      tool.phase === 'running' ||
      tool.phase === 'pending-approval'
    ) {
      return {
        headline: i18n.t('tool.diagnosticsChecking'),
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      };
    }
    if (tool.phase === 'failed') {
      return {
        headline: i18n.t('tool.diagnosticsChecking'),
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      };
    }
    if (tool.phase === 'succeeded') {
      const output = tool.outputExcerpt?.trim() ?? '';
      if (diagnosticsOutputIsAllClean(output)) {
        return {
          headline: i18n.t('tool.diagnosticsNoIssues'),
          ...(snapshotDetail ? { detail: snapshotDetail } : {}),
        };
      }
      const issueCount = countDiagnosticsIssues(tool.outputExcerpt);
      if (issueCount === 0) {
        return {
          headline: i18n.t('tool.diagnosticsNoIssues'),
          ...(snapshotDetail ? { detail: snapshotDetail } : {}),
        };
      }
      return {
        headline: i18n.t('tool.diagnosticsIssueCount', { count: issueCount }),
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      };
    }
  }

  // --- Dynamic re-translation for known tools ---
  // Re-derive headline from toolName + phase using the renderer's current locale
  // so that switching language instantly refreshes all tool card verbs.
  if (tool.toolName === 'apply_patch') {
    const matched = APPLY_PATCH_VERB_VARIANTS.find((entry) => entry.values.has(headline));
    if (matched) {
      const ctx = phaseToVerbContext(tool.phase);
      return {
        headline: i18n.t(matched.key, ctx ? { context: ctx } : {}),
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      };
    }
  }

  const verbKey = TOOL_VERB_KEY_MAP[tool.toolName];
  if (verbKey) {
    const ctx = phaseToVerbContext(tool.phase);
    const beforeItems =
      tool.toolName === 'todo_write'
        ? resolveTodoWriteBeforeSnapshot(tool.todoWriteBeforeTodos, [])
        : [];
    const todoWriteDetail =
      tool.toolName === 'todo_write'
        ? todoWriteSummaryDetail({
            before: beforeItems,
            afterPayload: tool.outputExcerpt ?? tool.argsExcerpt,
            t: (key, countOpts) => i18n.t(key, ctx ? { context: ctx, ...countOpts } : countOpts),
            separator: i18n.t('tool.todoWriteDeltaSeparator'),
          })
        : undefined;
    const grepDetail =
      tool.toolName === 'grep'
        ? (() => {
            const request = parseGrepRequestFromArgsExcerpt(tool.argsExcerpt);
            return request
              ? grepToolHeadlineDetail(request, (key, opts) => i18n.t(key, opts))
              : undefined;
          })()
        : undefined;
    const inFlightTodoWrite =
      tool.toolName === 'todo_write'
      && (tool.phase === 'preview' || tool.phase === 'running' || tool.phase === 'pending-approval');
    let detail: string | undefined;
    if (tool.toolName === 'todo_write') {
      if (inFlightTodoWrite) {
        // preview/running 时 headlineDetail 由 orchestrator 用完整 previewRequest 写入；argsExcerpt 流式重算不可靠
        detail = snapshotDetail ?? todoWriteDetail;
      } else if (beforeItems.length === 0 && snapshotDetail) {
        detail = snapshotDetail;
      } else {
        detail = todoWriteDetail ?? snapshotDetail;
      }
    } else if (tool.toolName === 'grep') {
      detail = grepDetail ?? snapshotDetail;
    } else {
      detail = todoWriteDetail || snapshotDetail;
    }
    return {
      headline: i18n.t(verbKey, ctx ? { context: ctx } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  return {
    headline,
    ...(snapshotDetail ? { detail: snapshotDetail } : {}),
  };
}

/** Plain one-line tool summary for clipboard export (matches MinimalToolSummary text). */
export function formatToolCallSummaryPlainText(tool: ToolBlockSnapshot): string {
  const summary = getToolCallSummaryParts(tool);
  let text: string;
  if (summary.shellSummary) {
    text = summary.detail
      ? `${summary.shellSummary.verb} ${summary.shellSummary.reason} ${summary.detail}`
      : `${summary.shellSummary.verb} ${summary.shellSummary.reason}`;
  } else {
    text = summary.detail ? `${summary.headline} ${summary.detail}` : summary.headline;
  }
  if (tool.phase === 'failed') {
    text = `${text} ${i18n.t('settings.failed')}`;
  }
  return text;
}

function fileDiffToolHasExpandableContent(tool: ToolBlockSnapshot): boolean {
  if (!FILE_DIFF_TOOL_NAMES.has(tool.toolName)) {
    return false;
  }

  if (
    Boolean(tool.outputExcerpt?.trim()) ||
    tool.detailLines.some((line) => line.trim()) ||
    tool.deleteFileBaselineText !== undefined
  ) {
    return true;
  }

  if (tool.phase === 'preview' || tool.phase === 'running') {
    return (
      Boolean(tool.argsExcerpt?.trim()) ||
      Boolean(tool.streamingArgumentsJson?.trim())
    );
  }

  return Boolean(tool.argsExcerpt?.trim());
}

function responsesBuiltInToolHasExpandableContent(tool: ToolBlockSnapshot): boolean {
  if (!isResponsesBuiltInToolCard(tool.toolName)) {
    return false;
  }
  return (
    Boolean(tool.outputExcerpt?.trim()) ||
    Boolean(tool.argsExcerpt?.trim()) ||
    tool.detailLines.some((line) => line.trim())
  );
}

export function toolHasExpandableContent(tool: ToolBlockSnapshot): boolean {
  if (tool.toolName === 'read_file') {
    return false;
  }

  if (FILE_DIFF_TOOL_NAMES.has(tool.toolName)) {
    return fileDiffToolHasExpandableContent(tool);
  }

  if (isResponsesBuiltInToolCard(tool.toolName)) {
    return responsesBuiltInToolHasExpandableContent(tool);
  }

  if (tool.toolName === 'shell') {
    const command = tool.headlineDetail?.trim() || parseShellToolCommand(tool);
    return shellHasExpandableContent(tool, command);
  }

  if (tool.toolName === 'run_subagent') {
    return (
      Boolean(tool.outputExcerpt?.trim()) ||
      tool.detailLines.some((line) => line.trim()) ||
      Boolean(tool.argsExcerpt?.trim()) ||
      tool.phase === 'preview' ||
      tool.phase === 'running'
    );
  }

  return (
    Boolean(tool.outputExcerpt?.trim()) ||
    tool.detailLines.some((line) => line.trim()) ||
    (tool.phase === 'preview' && Boolean(tool.argsExcerpt?.trim()))
  );
}

export function genericExpandableDetailLines(tool: ToolBlockSnapshot): string[] {
  return tool.detailLines.filter((line) => line.trim().length > 0);
}

export function shellToolExpandableDetailLines(
  tool: ToolBlockSnapshot,
  command: string | undefined,
): string[] {
  return shellExpandableDetailLines(tool, command);
}

export function isMinimalToolCallMessage(message: {
  role: string;
  content: string;
  tool?: ToolBlockSnapshot;
}): boolean {
  if (message.role !== 'assistant' || message.content.trim()) {
    return false;
  }
  if (!message.tool) {
    return false;
  }
  return message.tool.toolName !== 'generate_image' && message.tool.toolName !== 'generate_video';
}
