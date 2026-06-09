import { useTranslation } from "react-i18next";

import {
  lspDiagnosticsCounts,
  toolCardSecondaryTextClass,
} from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type { LspWriteDiagnosticsUi } from "@spirit-agent/core";

export function FileToolLspDiagnosticsBadge({
  diagnostics,
}: {
  diagnostics: LspWriteDiagnosticsUi;
}) {
  const { t } = useTranslation();
  const { errorCount, warningCount } = lspDiagnosticsCounts(diagnostics);
  const totalIssues = errorCount + warningCount;
  if (totalIssues === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 text-xs leading-relaxed",
        toolCardSecondaryTextClass,
      )}
    >
      {t("tool.diagnosticsIssueCount", { count: totalIssues })}
    </span>
  );
}
