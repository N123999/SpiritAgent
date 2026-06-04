import type { LspWriteDiagnosticsUi } from '@spirit-agent/agent-core';

import type { ToolBlockSnapshot } from '@/types';

/** 与工具卡 headlineDetail 文件名（如 utils.ts）同色阶。 */
export const toolCardFileNameDetailClass =
  'text-muted-foreground/42 dark:text-muted-foreground/45';

/** @deprecated 与 {@link toolCardFileNameDetailClass} 相同；shell `{command}` 暂共用。 */
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
