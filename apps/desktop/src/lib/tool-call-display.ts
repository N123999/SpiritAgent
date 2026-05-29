import {
  parseShellCommand,
  shellExpandableDetailLines,
  shellHasExpandableContent,
} from '@/lib/shell-tool-display';
import type { ToolBlockSnapshot } from '@/types';

export type ToolCallSummaryParts = {
  headline: string;
  detail?: string;
};

const LEGACY_READ_FILE_HEADLINE = /^查看\s+(.+)$/u;

export function getToolCallSummaryParts(tool: ToolBlockSnapshot): ToolCallSummaryParts {
  const headline = tool.headline.trim();
  let snapshotDetail = tool.headlineDetail?.trim();

  if (tool.toolName === 'read_file' && !snapshotDetail) {
    const legacy = LEGACY_READ_FILE_HEADLINE.exec(headline);
    if (legacy) {
      return { headline: '查看', detail: legacy[1] };
    }
  }

  if (tool.toolName === 'run_shell_command') {
    const command = snapshotDetail || parseShellCommand(tool);
    return {
      headline,
      ...(command ? { detail: command } : {}),
    };
  }

  return {
    headline,
    ...(snapshotDetail ? { detail: snapshotDetail } : {}),
  };
}

export function toolHasExpandableContent(tool: ToolBlockSnapshot): boolean {
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
  return message.tool.toolName !== 'generate_image';
}
