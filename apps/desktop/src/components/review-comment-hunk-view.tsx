import { useMemo } from "react";

import {
  Diff,
  Hunk,
  computeNewLineNumber,
  isDelete,
  isInsert,
  parseDiff,
  type GutterOptions,
  type HunkData,
} from "react-diff-view";
import "react-diff-view/style/index.css";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

export type ReviewCommentHunkViewProps = {
  path: string;
  diffHunk: string;
  className?: string;
  /** Match parent card (`bg-muted`) instead of page background. */
  surface?: "default" | "card";
  /** Highlight the review comment target line in the new file. */
  highlightLine?: number | null;
  /** `scroll`: capped ScrollArea (review threads). `embedded`: no inner scroll (PR Changes). */
  layout?: "scroll" | "embedded";
};

function reviewDiffSurfaceClass(surface: ReviewCommentHunkViewProps["surface"]): string {
  return surface === "card" ? "bg-muted" : "bg-background";
}

function reviewDiffInnerClass(surface: ReviewCommentHunkViewProps["surface"]): string {
  return cn(
    "tool-call-diff tool-call-diff--single-gutter min-w-0",
    surface === "card" && "tool-call-diff--card-surface",
  );
}

/** GitHub-style unified gutter: one line number per row (new side, or old on deletes). */
function renderUnifiedReviewGutter({
  change,
  side,
  renderDefault,
  wrapInAnchor,
}: GutterOptions) {
  if (isDelete(change)) {
    return side === "old" ? wrapInAnchor(renderDefault()) : null;
  }
  if (isInsert(change)) {
    return side === "new" ? wrapInAnchor(renderDefault()) : null;
  }
  return side === "new" ? wrapInAnchor(renderDefault()) : null;
}

function useReviewDiffLineClassName(highlightLine: number | null | undefined) {
  return useMemo(() => {
    if (highlightLine == null) {
      return undefined;
    }

    return ({
      changes,
      defaultGenerate,
    }: {
      changes: readonly (Parameters<typeof computeNewLineNumber>[0] | undefined)[];
      defaultGenerate: () => string;
    }) => {
      const base = defaultGenerate();
      const highlighted = changes.some((change) => {
        if (!change) {
          return false;
        }
        return computeNewLineNumber(change) === highlightLine;
      });
      return highlighted ? cn(base, "review-diff-target-line") : base;
    };
  }, [highlightLine]);
}

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

export function ReviewCommentHunkView({
  path,
  diffHunk,
  className,
  surface = "default",
  highlightLine = null,
  layout = "scroll",
}: ReviewCommentHunkViewProps) {
  const generateLineClassName = useReviewDiffLineClassName(highlightLine);
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
          "w-full overflow-x-auto whitespace-pre-wrap break-words border border-border/20 p-2 font-mono text-xs leading-relaxed text-muted-foreground",
          reviewDiffSurfaceClass(surface),
          className,
        )}
      >
        {diffHunk}
      </pre>
    );
  }

  const diffContent = (
    <div className={reviewDiffInnerClass(surface)}>
      <Diff
        viewType="unified"
        diffType="modify"
        hunks={hunks}
        gutterType="default"
        renderGutter={renderUnifiedReviewGutter}
        generateLineClassName={generateLineClassName}
      >
        {(renderedHunks) =>
          renderedHunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
        }
      </Diff>
    </div>
  );

  if (layout === "embedded") {
    return (
      <div
        className={cn(
          "w-full border-t border-border/20",
          reviewDiffSurfaceClass(surface),
          className,
        )}
      >
        {diffContent}
      </div>
    );
  }

  return (
    <ScrollArea
      className={cn(
        "max-h-48 rounded-md border border-border/20",
        reviewDiffSurfaceClass(surface),
        className,
      )}
      type="always"
    >
      {diffContent}
    </ScrollArea>
  );
}
