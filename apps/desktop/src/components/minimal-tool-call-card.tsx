import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { FileToolLspDiagnosticsBadge } from "@/components/file-tool-lsp-diagnostics-badge";
import {
  FileToolLspDiagnosticsHover,
  FileToolLspDiagnosticsHoverTrigger,
} from "@/components/file-tool-lsp-diagnostics-hover";
import { ToolCallDiffView } from "@/components/tool-call-diff-view";
import { useToolCallDiffHost } from "@/components/tool-call-diff-host-context";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { resolveToolLineDelta } from "@/lib/edit-file-line-delta";
import {
  type FileToolDiffSource,
  isFileDiffTool,
  resolveFileToolDiffSource,
  resolvePlanRelativePath,
} from "@/lib/file-tool-diff-source";
import {
  genericExpandableDetailLines,
  getToolCallSummaryParts,
  isResponsesBuiltInToolCard,
  shellToolExpandableDetailLines,
  toolCallPhaseShowsShimmer,
  toolHasExpandableContent,
  type ShellToolSummaryParts,
} from "@/lib/tool-call-display";
import { parseShellCommand } from "@/lib/shell-tool-display";
import {
  shouldShowLspDiagnosticsOnToolCard,
  toolCardFileNameDetailClass,
} from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

const summaryClass = "text-xs leading-relaxed text-muted-foreground";

export type ToolSummaryDetailTone = "default" | "shell-command";

/**
 * Shell summary grey ramp (verb → reason → command), aligned across themes:
 * light: 100% → 75% → 42% opacity; dark: 100% → 65% → 45%.
 */
const summaryShellReasonClass =
  "text-muted-foreground/75 dark:text-muted-foreground/65";

const summaryShellCommandClass = toolCardFileNameDetailClass;

const summaryDetailToneClass: Record<ToolSummaryDetailTone, string> = {
  default: summaryShellCommandClass,
  "shell-command": summaryShellCommandClass,
};

function ToolCallSummaryRow({
  tool,
  headline,
  detail,
  shellSummary,
  shimmerActive = false,
  detailTone = "default",
}: {
  tool: ToolBlockSnapshot;
  headline: string;
  detail?: string;
  shellSummary?: ShellToolSummaryParts;
  shimmerActive?: boolean;
  detailTone?: ToolSummaryDetailTone;
}) {
  const editLineDelta = useMemo(() => resolveToolLineDelta(tool), [
    tool.toolName,
    tool.editLineDelta,
    tool.argsExcerpt,
  ]);

  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
      <MinimalToolSummary
        headline={headline}
        detail={detail}
        shellSummary={shellSummary}
        shimmerActive={shimmerActive}
        detailTone={detailTone}
      />
      {editLineDelta ? <EditFileLineDeltaBadge delta={editLineDelta} /> : null}
      {shouldShowLspDiagnosticsOnToolCard(tool) ? (
        <FileToolLspDiagnosticsBadge diagnostics={tool.lspWriteDiagnostics} />
      ) : null}
    </span>
  );
}

export function MinimalToolSummary({
  headline,
  detail,
  shellSummary,
  shimmerActive = false,
  detailTone = "default",
}: {
  headline: string;
  detail?: string;
  shellSummary?: ShellToolSummaryParts;
  shimmerActive?: boolean;
  detailTone?: ToolSummaryDetailTone;
}) {
  const shimmerClass = shimmerActive
    ? "spirit-thinking-shimmer-text font-medium tracking-wide"
    : summaryClass;

  return (
    <span className={cn("min-w-0 break-words text-xs leading-relaxed")}>
      {shellSummary ? (
        <>
          <span className={shimmerClass}>{shellSummary.verb}</span>
          {" "}
          <span className={shimmerActive ? shimmerClass : summaryShellReasonClass}>
            {shellSummary.reason}
          </span>
        </>
      ) : (
        <span className={shimmerClass}>{headline}</span>
      )}
      {detail ? (
        <>
          {" "}
          <span className={summaryDetailToneClass[detailTone]}>{detail}</span>
        </>
      ) : null}
    </span>
  );
}

function ResponsesBuiltInToolExpandedBody({
  tool,
  shimmerActive,
}: {
  tool: ToolBlockSnapshot;
  shimmerActive: boolean;
}) {
  const input = tool.argsExcerpt?.trim() ?? "";
  const output = tool.outputExcerpt?.trim() ?? "";

  return (
    <div className="space-y-3">
      {input ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Input</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {input}
          </pre>
        </div>
      ) : null}
      {output ? (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Output</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
            {output}
          </pre>
        </div>
      ) : shimmerActive ? (
        <p className="text-xs leading-relaxed text-muted-foreground/70 spirit-thinking-shimmer-text">
          Waiting for output…
        </p>
      ) : null}
    </div>
  );
}

function GenericToolExpandedBody({ tool }: { tool: ToolBlockSnapshot }) {
  const detailLines = genericExpandableDetailLines(tool);
  const showArgsExcerpt =
    tool.phase === "preview" && Boolean(tool.argsExcerpt?.trim()) && !tool.outputExcerpt?.trim();

  return (
    <div className="space-y-2">
      {tool.outputExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.outputExcerpt}
        </pre>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
          {detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {showArgsExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.argsExcerpt}
        </pre>
      ) : null}
    </div>
  );
}

function FileToolDiffExpandedBody({
  tool,
  open,
}: {
  tool: ToolBlockSnapshot;
  open: boolean;
}) {
  const { t } = useTranslation();
  const diffHost = useToolCallDiffHost();
  const diffMounted = useCollapsibleChildMount(open);
  const cachedDiffRef = useRef<FileToolDiffSource | null>(null);
  const [planBaselineText, setPlanBaselineText] = useState<string | undefined>();

  const planRelativePath = useMemo(() => {
    if (!open || tool.toolName !== "create_plan") {
      return undefined;
    }
    return resolvePlanRelativePath(
      tool,
      open ? tool.streamingArgumentsJson : undefined,
    );
  }, [open, tool.toolName, tool.phase, tool.argsExcerpt, open ? tool.streamingArgumentsJson : undefined]);

  useEffect(() => {
    if (!open || !planRelativePath || !diffHost) {
      setPlanBaselineText(undefined);
      return;
    }
    let cancelled = false;
    void diffHost
      .readWorkspaceTextFile(planRelativePath)
      .then((result) => {
        if (!cancelled) {
          setPlanBaselineText(result.text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlanBaselineText(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [diffHost, open, planRelativePath]);

  const diffResult = useMemo(
    () =>
      resolveFileToolDiffSource(tool, {
        open,
        workspaceRoot: diffHost?.workspaceRoot,
        planBaselineText,
      }),
    [
      open,
      tool.toolCallId,
      tool.toolName,
      tool.phase,
      tool.argsExcerpt,
      tool.deleteFileBaselineText,
      tool.fileToolDiffArgumentsJson,
      open ? tool.streamingArgumentsJson : undefined,
      diffHost?.workspaceRoot,
      planBaselineText,
    ],
  );

  if (diffResult && typeof diffResult === "object") {
    cachedDiffRef.current = diffResult;
  }

  const displayDiff =
    diffResult && typeof diffResult === "object"
      ? diffResult
      : diffMounted
        ? cachedDiffRef.current
        : null;

  if (!diffMounted) {
    return null;
  }

  if (diffResult === "truncated") {
    return (
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-muted-foreground">{t("tool.diffArgsTruncated")}</p>
        <GenericToolExpandedBody tool={tool} />
      </div>
    );
  }

  if (diffResult === "too-large") {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">{t("tool.diffFileTooLarge")}</p>
    );
  }

  if (displayDiff) {
    return (
      <ToolCallDiffView
        relativePath={displayDiff.relativePath}
        languageId={displayDiff.languageId}
        original={displayDiff.original}
        modified={displayDiff.modified}
        followTail={open && tool.phase === "preview"}
      />
    );
  }

  return <GenericToolExpandedBody tool={tool} />;
}

function ShellToolExpandedBody({
  tool,
  command,
}: {
  tool: ToolBlockSnapshot;
  command: string | undefined;
}) {
  const detailLines = shellToolExpandableDetailLines(tool, command);
  const showArgsExcerpt = !command && Boolean(tool.argsExcerpt?.trim());

  return (
    <div className="space-y-2">
      {tool.outputExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.outputExcerpt}
        </pre>
      ) : null}
      {detailLines.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-3.5 text-xs leading-relaxed text-muted-foreground">
          {detailLines.map((line, index) => (
            <li key={`${index}:${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
      {showArgsExcerpt ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground">
          {tool.argsExcerpt}
        </pre>
      ) : null}
    </div>
  );
}

export function MinimalToolCallCard({ tool }: { tool: ToolBlockSnapshot }) {
  const summary = getToolCallSummaryParts(tool);
  const shimmerActive = toolCallPhaseShowsShimmer(tool.phase);
  const isShell = tool.toolName === "run_shell_command";
  const isFileDiff = isFileDiffTool(tool.toolName);
  const isResponsesBuiltIn = isResponsesBuiltInToolCard(tool.toolName);
  const shellCommand = useMemo(
    () => (isShell ? tool.headlineDetail?.trim() || parseShellCommand(tool) : undefined),
    [isShell, tool.argsExcerpt, tool.detailLines, tool.headlineDetail],
  );
  const expandable = toolHasExpandableContent(tool);
  const [open, setOpen] = useState(false);
  const showLspHover = shouldShowLspDiagnosticsOnToolCard(tool);
  const lspHoverItemId = tool.toolCallId ?? tool.toolName;
  const lspDiagnostics = showLspHover ? tool.lspWriteDiagnostics : undefined;

  const summaryRow = (
    <ToolCallSummaryRow
      tool={tool}
      headline={summary.headline}
      detail={summary.detail}
      shellSummary={summary.shellSummary}
      shimmerActive={shimmerActive}
      detailTone={isShell ? "shell-command" : "default"}
    />
  );

  if (!expandable) {
    const plainCard = (
      <p className={shimmerActive ? undefined : summaryClass}>{summaryRow}</p>
    );
    if (!lspDiagnostics) {
      return plainCard;
    }
    return (
      <FileToolLspDiagnosticsHover itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
        <FileToolLspDiagnosticsHoverTrigger itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
          {plainCard}
        </FileToolLspDiagnosticsHoverTrigger>
      </FileToolLspDiagnosticsHover>
    );
  }

  const expandedBody = (
    <div className="pt-1.5">
      {isShell ? (
        <ShellToolExpandedBody tool={tool} command={shellCommand} />
      ) : isFileDiff ? (
        <FileToolDiffExpandedBody tool={tool} open={open} />
      ) : isResponsesBuiltIn ? (
        <ResponsesBuiltInToolExpandedBody tool={tool} shimmerActive={shimmerActive} />
      ) : (
        <GenericToolExpandedBody tool={tool} />
      )}
    </div>
  );

  const collapsibleTriggerButton = (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
        "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {summaryRow}
      <ChevronRight
        className={cn(
          "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
          "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          open && "rotate-90",
        )}
        aria-hidden
      />
    </button>
  );

  const collapsibleInner = (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      {lspDiagnostics ? (
        <FileToolLspDiagnosticsHoverTrigger itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
          {collapsibleTriggerButton}
        </FileToolLspDiagnosticsHoverTrigger>
      ) : (
        collapsibleTriggerButton
      )}
      <CollapsibleContent className="min-w-0">{expandedBody}</CollapsibleContent>
    </Collapsible>
  );

  if (!lspDiagnostics) {
    return collapsibleInner;
  }

  return (
    <FileToolLspDiagnosticsHover itemId={lspHoverItemId} diagnostics={lspDiagnostics}>
      {collapsibleInner}
    </FileToolLspDiagnosticsHover>
  );
}
