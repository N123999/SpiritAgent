import { useMemo } from "react";

import { Diff, Hunk, parseDiff, type HunkData } from "react-diff-view";
import "react-diff-view/style/index.css";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

export type ReviewCommentHunkViewProps = {
  path: string;
  diffHunk: string;
  className?: string;
};

function buildReviewCommentDiffText(path: string, diffHunk: string): string {
  const normalizedPath = path.replace(/\\/gu, "/").trim() || "file";
  const hunk = diffHunk.trim();
  if (!hunk) {
    return "";
  }
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    hunk,
  ].join("\n");
}

export function ReviewCommentHunkView({ path, diffHunk, className }: ReviewCommentHunkViewProps) {
  const hunks = useMemo((): HunkData[] => {
    const diffText = buildReviewCommentDiffText(path, diffHunk);
    if (!diffText) {
      return [];
    }
    try {
      const files = parseDiff(diffText, { nearbySequences: "zip" });
      return files[0]?.hunks ?? [];
    } catch {
      return [];
    }
  }, [diffHunk, path]);

  if (hunks.length === 0) {
    if (!diffHunk.trim()) {
      return null;
    }
    return (
      <pre
        className={cn(
          "overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-background p-2 font-mono text-xs leading-relaxed text-muted-foreground",
          className,
        )}
      >
        {diffHunk}
      </pre>
    );
  }

  return (
    <ScrollArea className={cn("max-h-48 rounded-md border border-border/20", className)} type="always">
      <div className="tool-call-diff min-w-0">
        <Diff viewType="unified" diffType="modify" hunks={hunks} gutterType="none">
          {(renderedHunks) =>
            renderedHunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
          }
        </Diff>
      </div>
    </ScrollArea>
  );
}
