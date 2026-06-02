import { useMemo, useState } from "react";

import { ChevronRight } from "lucide-react";

import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { resolveToolLineDelta } from "@/lib/edit-file-line-delta";
import {
  genericExpandableDetailLines,
  getToolCallSummaryParts,
  shellToolExpandableDetailLines,
  toolCallPhaseShowsShimmer,
  toolHasExpandableContent,
} from "@/lib/tool-call-display";
import { parseShellCommand } from "@/lib/shell-tool-display";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

const summaryClass = "text-xs leading-relaxed text-muted-foreground";

function ToolCallSummaryRow({
  tool,
  headline,
  detail,
  shimmerActive = false,
}: {
  tool: ToolBlockSnapshot;
  headline: string;
  detail?: string;
  shimmerActive?: boolean;
}) {
  const editLineDelta = useMemo(() => resolveToolLineDelta(tool), [
    tool.toolName,
    tool.editLineDelta,
    tool.argsExcerpt,
  ]);

  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
      <MinimalToolSummary headline={headline} detail={detail} shimmerActive={shimmerActive} />
      {editLineDelta ? <EditFileLineDeltaBadge delta={editLineDelta} /> : null}
    </span>
  );
}

export function MinimalToolSummary({
  headline,
  detail,
  shimmerActive = false,
}: {
  headline: string;
  detail?: string;
  shimmerActive?: boolean;
}) {
  return (
    <span className={cn("min-w-0 break-words text-xs leading-relaxed")}>
      <span
        className={cn(
          shimmerActive
            ? "spirit-thinking-shimmer-text font-medium tracking-wide"
            : summaryClass,
        )}
      >
        {headline}
      </span>
      {detail ? (
        <>
          {" "}
          <span className="text-muted-foreground/45">{detail}</span>
        </>
      ) : null}
    </span>
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
  const shellCommand = useMemo(
    () => (isShell ? tool.headlineDetail?.trim() || parseShellCommand(tool) : undefined),
    [isShell, tool.argsExcerpt, tool.detailLines, tool.headlineDetail],
  );
  const expandable = toolHasExpandableContent(tool);
  const [open, setOpen] = useState(false);

  if (!expandable) {
    return (
      <p className={shimmerActive ? undefined : summaryClass}>
        <ToolCallSummaryRow
          tool={tool}
          headline={summary.headline}
          detail={summary.detail}
          shimmerActive={shimmerActive}
        />
      </p>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full min-w-0 items-center gap-1 text-left outline-none",
            "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <ToolCallSummaryRow
            tool={tool}
            headline={summary.headline}
            detail={summary.detail}
            shimmerActive={shimmerActive}
          />
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
              "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
              open && "rotate-90",
            )}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0">
        <div className="pt-1.5">
          {isShell ? (
            <ShellToolExpandedBody tool={tool} command={shellCommand} />
          ) : (
            <GenericToolExpandedBody tool={tool} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
