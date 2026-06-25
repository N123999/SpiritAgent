import {
  parseShellToolResult as parseShellToolResultPayload,
  type ShellToolResult,
} from "@spirit-agent/core/shell-tool-result";

import i18n from "@/lib/i18n";
import type { ToolBlockSnapshot } from "@/types";

export function parseShellToolResult(
  outputExcerpt: string | undefined,
): ShellToolResult | null {
  if (!outputExcerpt?.trim()) {
    return null;
  }
  return parseShellToolResultPayload(outputExcerpt);
}

const COMMAND_LINE_PREFIX = i18n.t('tool.commandPrefix');

export function parseShellToolCommand(
  tool: Pick<ToolBlockSnapshot, "argsExcerpt" | "detailLines">,
): string | undefined {
  const excerpt = tool.argsExcerpt?.trim();
  if (excerpt) {
    try {
      const parsed = JSON.parse(excerpt) as { command?: unknown };
      if (typeof parsed.command === "string") {
        const trimmed = parsed.command.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    } catch {
      // argsExcerpt may be truncated or non-JSON during streaming
    }
  }

  for (const line of tool.detailLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(COMMAND_LINE_PREFIX)) {
      const command = trimmed.slice(COMMAND_LINE_PREFIX.length).trim();
      if (command) {
        return command;
      }
    }
  }

  return undefined;
}

export function shellExpandableDetailLines(
  tool: Pick<ToolBlockSnapshot, "detailLines">,
  command: string | undefined,
): string[] {
  return tool.detailLines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    if (!command) {
      return true;
    }
    if (trimmed === command) {
      return false;
    }
    if (trimmed.startsWith(COMMAND_LINE_PREFIX)) {
      const fromLine = trimmed.slice(COMMAND_LINE_PREFIX.length).trim();
      if (fromLine === command) {
        return false;
      }
    }
    return true;
  });
}

export function shellHasExpandableContent(
  tool: Pick<ToolBlockSnapshot, "argsExcerpt" | "detailLines" | "outputExcerpt" | "phase">,
  command: string | undefined,
): boolean {
  if (tool.phase === 'running' || tool.phase === 'preview') {
    return true;
  }
  if (tool.outputExcerpt?.trim()) {
    return true;
  }
  if (shellExpandableDetailLines(tool, command).length > 0) {
    return true;
  }
  if (!command && tool.argsExcerpt?.trim()) {
    return true;
  }
  return false;
}
