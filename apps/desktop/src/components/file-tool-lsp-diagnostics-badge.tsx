import { useTranslation } from "react-i18next";

import {
  formatLspDiagnosticsSummaryLabel,
  lspDiagnosticsCounts,
  toolCardFileNameDetailClass,
} from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type { LspWriteDiagnosticsUi } from "@spirit-agent/agent-core";

export function FileToolLspDiagnosticsBadge({
  diagnostics,
}: {
  diagnostics: LspWriteDiagnosticsUi;
}) {
  const { t } = useTranslation();
  const { errorCount, warningCount } = lspDiagnosticsCounts(diagnostics);
  const label = formatLspDiagnosticsSummaryLabel(errorCount, warningCount, t);
  if (!label) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 text-xs leading-relaxed",
        toolCardFileNameDetailClass,
      )}
    >
      {label}
    </span>
  );
}
