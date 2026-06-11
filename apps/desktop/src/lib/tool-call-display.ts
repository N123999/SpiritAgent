import { FILE_DIFF_TOOL_NAMES } from '@/lib/file-tool-diff-source.js';
import i18n from '@/lib/i18n';
import {
  parseShellCommand,
  shellExpandableDetailLines,
  shellHasExpandableContent,
} from '@/lib/shell-tool-display';
import { phaseToVerbContext } from '@/lib/tool-verb-context';
import type { ToolBlockSnapshot } from '@/types';

export type ShellToolSummaryParts = {
  verb: string;
  reason: string;
};

export type ToolCallSummaryParts = {
  headline: string;
  detail?: string;
  /** When set, headline is split into verb (darkest) + reason (mid) for run_shell_command. */
  shellSummary?: ShellToolSummaryParts;
};

export { toolCallPhaseShowsShimmer } from './tool-call-shimmer.js';

const RESPONSES_BUILT_IN_TOOL_NAMES = new Set([
  'web_search',
  'code_interpreter',
]);

const LEGACY_READ_FILE_HEADLINE = /^(?:查看|View(?:ing|ed)?)\.?\s+(.+)$/u;

function shellToolSummaryFromReason(
  reason: string,
  phase: ToolBlockSnapshot['phase'],
): Pick<ToolCallSummaryParts, 'headline' | 'shellSummary'> {
  const trimmed = reason.trim();
  const ctx = phaseToVerbContext(phase);
  const tOpts = ctx ? { context: ctx } : {};
  const defaultHeadline = i18n.t('tool.runCommand', tOpts);
  if (!trimmed || trimmed === defaultHeadline || trimmed === i18n.t('tool.runCommand')) {
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
  // "Diagnostics for src/x.ts (3 shown):" → 3
  const headerMatch = /^Diagnostics for .+?\((\d+) shown(?:,\s*(\d+) more omitted)?\):/.exec(
    outputExcerpt,
  );
  if (headerMatch) {
    const shown = Number(headerMatch[1]) || 0;
    const omitted = Number(headerMatch[2]) || 0;
    return shown + omitted;
  }
  // 兜底：按行统计（无 header 时）
  return outputExcerpt
    .split('\n')
    .filter((line) => /^(error|warning)\s/.test(line.trim()))
    .length;
}

export function getToolCallSummaryParts(tool: ToolBlockSnapshot): ToolCallSummaryParts {
  const headline = tool.headline.trim();
  const snapshotDetail = tool.headlineDetail?.trim();

  if (tool.toolName === 'read_file' && !snapshotDetail) {
    const legacy = LEGACY_READ_FILE_HEADLINE.exec(headline);
    if (legacy) {
      const ctx = phaseToVerbContext(tool.phase);
      return { headline: i18n.t('tool.view', ctx ? { context: ctx } : {}), detail: legacy[1] };
    }
  }

  if (tool.toolName === 'run_shell_command') {
    const command = snapshotDetail || parseShellCommand(tool);
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
      // 失败时透传上游 headline（如「工具执行失败: get_diagnostics」）
      return {
        headline,
        ...(snapshotDetail ? { detail: snapshotDetail } : {}),
      };
    }
    if (tool.phase === 'succeeded') {
      const output = tool.outputExcerpt?.trim() ?? '';
      if (output.startsWith('No errors or warnings')) {
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

  return {
    headline,
    ...(snapshotDetail ? { detail: snapshotDetail } : {}),
  };
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
  if (FILE_DIFF_TOOL_NAMES.has(tool.toolName)) {
    return fileDiffToolHasExpandableContent(tool);
  }

  if (isResponsesBuiltInToolCard(tool.toolName)) {
    return responsesBuiltInToolHasExpandableContent(tool);
  }

  if (tool.toolName === 'run_shell_command') {
    const command = tool.headlineDetail?.trim() || parseShellCommand(tool);
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
