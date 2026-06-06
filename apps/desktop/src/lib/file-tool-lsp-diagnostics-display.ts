import type { LspWriteDiagnosticsUi } from '@spirit-agent/core';

import type { ToolBlockSnapshot } from '@/types';

/** 短工具卡次级文字（shell 原因、文件名、LSP 摘要等）。 */
export const toolCardSecondaryTextClass =
  'text-muted-foreground/75 dark:text-muted-foreground/65';

/** shell `{命令}` 等更浅第三级；与原因色分开以免摘要行糊成一段。 */
export const toolCardFileNameDetailClass =
  'text-muted-foreground/42 dark:text-muted-foreground/45';

/** @deprecated 与 {@link toolCardFileNameDetailClass} 相同。 */
export const toolCardMutedDetailClass = toolCardFileNameDetailClass;

export function lspDiagnosticsCounts(diagnostics: LspWriteDiagnosticsUi): {
  errorCount: number;
  warningCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;
  for (const item of diagnostics.items) {
    if (item.severity === 'error') {
      errorCount += 1;
    } else if (item.severity === 'warning') {
      warningCount += 1;
    }
  }
  return { errorCount, warningCount };
}

export function shouldShowLspDiagnosticsOnToolCard(
  tool: Pick<ToolBlockSnapshot, 'phase' | 'lspWriteDiagnostics'>,
): tool is ToolBlockSnapshot & { lspWriteDiagnostics: LspWriteDiagnosticsUi } {
  if (tool.phase !== 'succeeded' || !tool.lspWriteDiagnostics) {
    return false;
  }
  const { errorCount, warningCount } = lspDiagnosticsCounts(tool.lspWriteDiagnostics);
  return errorCount > 0 || warningCount > 0;
}

export function formatLspDiagnosticsSummaryLabel(
  errorCount: number,
  warningCount: number,
  translate: (key: string, options?: { count: number }) => string,
): string | undefined {
  const parts: string[] = [];
  if (errorCount > 0) {
    parts.push(translate('tool.lspErrorCount', { count: errorCount }));
  }
  if (warningCount > 0) {
    parts.push(translate('tool.lspWarningCount', { count: warningCount }));
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}
