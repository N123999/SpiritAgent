import { FILE_DIFF_TOOL_NAMES } from '@/lib/file-tool-diff-source.js';
import i18n from '@/lib/i18n';
import {
  parseShellCommand,
  shellExpandableDetailLines,
  shellHasExpandableContent,
} from '@/lib/shell-tool-display';
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

const LEGACY_READ_FILE_HEADLINE = /^查看\s+(.+)$/u;

function shellToolSummaryFromReason(reason: string): Pick<ToolCallSummaryParts, 'headline' | 'shellSummary'> {
  const trimmed = reason.trim();
  const defaultHeadline = i18n.t('tool.runCommand');
  if (!trimmed || trimmed === defaultHeadline) {
    return { headline: defaultHeadline };
  }
  const verb = i18n.t('tool.runShellVerb');
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
      return { headline: '查看', detail: legacy[1] };
    }
  }

  if (tool.toolName === 'run_shell_command') {
    const command = snapshotDetail || parseShellCommand(tool);
    return {
      ...shellToolSummaryFromReason(headline),
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
