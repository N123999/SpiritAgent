import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { Check, Copy, GitCommit, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipItem, useTooltipTriggerProps } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { PrConversationTimelineNode } from "@/components/workspace-pr-conversation-timeline";
import { WorkspaceGitCommitContextMenuContent } from "@/components/workspace-git-commit-context-menu";
import { cn } from "@/lib/utils";
import type { GitCommitGraphRow, GitCommitRecord, GitHistorySnapshot } from "@/types";

const ROW_HEIGHT_PX = 32;
const LANE_WIDTH_PX = 16;
const GUTTER_LEADING_PX = 4;
/** Half of compact `PrConversationTimelineNode` (size-3.5) — matches `text-xs` row height. */
const NODE_RADIUS_PX = 7;
const TEXT_GAP_PX = 4;

function laneCenterX(lane: number): number {
  return GUTTER_LEADING_PX + lane * LANE_WIDTH_PX + LANE_WIDTH_PX / 2;
}

function rowTopY(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT_PX;
}

function activeLanesForRow(row: GitCommitGraphRow): number[] {
  const set = new Set<number>([row.lane, ...row.passingLanes, ...row.mergeLanes]);
  return [...set].sort((a, b) => a - b);
}

function maxLaneOnRow(row: GitCommitGraphRow): number {
  return activeLanesForRow(row).reduce((max, lane) => Math.max(max, lane), row.lane);
}

/** Text starts this many px after the commit node's lane center (dot radius + gap). */
function commitLaneTextInsetPx(row: GitCommitGraphRow): number {
  return Math.ceil(laneCenterX(row.lane) + NODE_RADIUS_PX + TEXT_GAP_PX);
}

/** Wider inset when a merge forks a side lane — keeps fork-start rows unchanged. */
function mergeForkTextInsetPx(
  row: GitCommitGraphRow,
  rowIndex: number,
  rows: readonly GitCommitGraphRow[],
): number {
  let maxLane = maxLaneOnRow(row);
  const prev = rows[rowIndex - 1];
  const next = rows[rowIndex + 1];
  if (prev) {
    maxLane = Math.max(maxLane, maxLaneOnRow(prev));
  }
  if (next) {
    maxLane = Math.max(maxLane, maxLaneOnRow(next));
  }
  return Math.ceil(laneCenterX(maxLane) + NODE_RADIUS_PX + TEXT_GAP_PX);
}

function isMainRejoinAfterBranch(
  row: GitCommitGraphRow,
  rowIndex: number,
  rows: readonly GitCommitGraphRow[],
): boolean {
  const prev = rows[rowIndex - 1];
  return row.lane === 0 && Boolean(prev && prev.lane > 0);
}

function textInsetForRow(
  row: GitCommitGraphRow,
  rowIndex: number,
  rows: readonly GitCommitGraphRow[],
): number {
  if (row.mergeLanes.length > 0) {
    return mergeForkTextInsetPx(row, rowIndex, rows);
  }
  // Rejoin row: dot on lane 0 but text stays aligned with the side branch column above.
  if (isMainRejoinAfterBranch(row, rowIndex, rows)) {
    const prev = rows[rowIndex - 1]!;
    return commitLaneTextInsetPx(prev);
  }
  return commitLaneTextInsetPx(row);
}

function computeGraphWidth(rows: readonly GitCommitGraphRow[]): number {
  return rows.reduce(
    (max, row, rowIndex) => Math.max(max, textInsetForRow(row, rowIndex, rows)),
    0,
  );
}

export type GitCommitGraphProps = {
  history: GitHistorySnapshot | null;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onAddCommitToSession?: (commit: GitCommitRecord) => void;
  addCommitToSessionDisabled?: boolean;
  error?: string;
  className?: string;
};

function laneContinuesBelow(rowIndex: number, lane: number, rows: GitCommitGraphRow[]): boolean {
  const next = rows[rowIndex + 1];
  if (!next) {
    return false;
  }
  if (next.lane === lane) {
    return true;
  }
  return next.passingLanes.includes(lane) || next.mergeLanes.includes(lane);
}

function laneContinuesAbove(rowIndex: number, lane: number, rows: GitCommitGraphRow[]): boolean {
  if (rowIndex <= 0) {
    return false;
  }
  const prev = rows[rowIndex - 1];
  if (!prev) {
    return false;
  }
  if (prev.lane === lane) {
    return true;
  }
  return prev.passingLanes.includes(lane) || prev.mergeLanes.includes(lane);
}

/** Merges collinear verticals into one subpath per lane to avoid round-cap gaps between rows. */
class LanePathBuilder {
  private readonly strokes = new Map<number, { x: number; parts: string[]; penY: number | null }>();
  private readonly curves: string[] = [];

  appendVertical(lane: number, x: number, y1: number, y2: number): void {
    if (y2 <= y1) {
      return;
    }
    let stroke = this.strokes.get(lane);
    if (!stroke || stroke.x !== x) {
      stroke = { x, parts: [], penY: null };
      this.strokes.set(lane, stroke);
    }
    if (stroke.penY === y1) {
      stroke.parts.push(`L ${x} ${y2}`);
    } else {
      stroke.parts.push(`M ${x} ${y1} L ${x} ${y2}`);
    }
    stroke.penY = y2;
  }

  appendCurve(d: string): void {
    if (!d) {
      return;
    }
    this.curves.push(d);
  }

  toPathLists(): { verticals: string[]; curves: string[] } {
    const verticals = [...this.strokes.values()]
      .map((stroke) => stroke.parts.join(" "))
      .filter((d) => d.length > 0);
    return { verticals, curves: [...this.curves] };
  }
}

/**
 * Cubic with vertical tangents at both ends (rounded lane change).
 * Control points share endpoint x so the curve stays inside the lane column band.
 */
function curveBetweenCommits(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2 && y1 === y2) {
    return "";
  }
  if (x1 === x2) {
    return y2 > y1 ? `M ${x1} ${y1} L ${x2} ${y2}` : "";
  }
  const dy = y2 - y1;
  const bend = Math.min(Math.abs(dy) * 0.55, ROW_HEIGHT_PX * 0.85);
  const c1y = y1 + Math.sign(dy) * bend;
  const c2y = y2 - Math.sign(dy) * bend;
  return `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`;
}

/** Merge parent on merge lane is usually the row directly below. */
function mergeParentRowIndex(
  rowIndex: number,
  mergeLane: number,
  rows: GitCommitGraphRow[],
): number | undefined {
  const below = rows[rowIndex + 1];
  if (!below) {
    return undefined;
  }
  if (below.lane === mergeLane) {
    return rowIndex + 1;
  }
  if (below.passingLanes.includes(mergeLane) || below.mergeLanes.includes(mergeLane)) {
    return rowIndex + 1;
  }
  return undefined;
}

type RowGeometry = { tops: number[]; heights: number[]; centers: number[]; total: number };

function CommitGraphGutter({
  rows,
  graphWidth,
  geometry,
}: {
  rows: GitCommitGraphRow[];
  graphWidth: number;
  geometry: RowGeometry | null;
}) {
  // Use measured DOM row offsets/heights so the graph aligns with variable-height rows
  // (ref badges, multi-line subjects). Fall back to fixed rows before first measurement.
  const rowTop = (i: number): number =>
    geometry && geometry.tops[i] !== undefined ? geometry.tops[i]! : rowTopY(i);
  const rowHeight = (i: number): number =>
    geometry && geometry.heights[i] !== undefined ? geometry.heights[i]! : ROW_HEIGHT_PX;
  const rowCenter = (i: number): number =>
    geometry?.centers[i] !== undefined ? geometry.centers[i]! : rowTop(i) + rowHeight(i) / 2;
  const rowBottom = (i: number): number => rowTop(i) + rowHeight(i);
  const height = geometry ? geometry.total : rows.length * ROW_HEIGHT_PX;
  const builder = new LanePathBuilder();

  const pushVertical = (lane: number, x: number, y1: number, y2: number): void => {
    builder.appendVertical(lane, x, y1, y2);
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    const yTop = rowTop(rowIndex);
    const yCenter = rowCenter(rowIndex);
    const yBottom = rowBottom(rowIndex);
    const nextRow = rows[rowIndex + 1];
    const prevRow = rows[rowIndex - 1];
    const mergeLanes = new Set(row.mergeLanes);

    const branchFromParentBelow = Boolean(
      nextRow && nextRow.lane !== row.lane,
    );
    const parentLaneIsMergeParent = Boolean(
      nextRow && row.mergeLanes.length > 0 && row.mergeLanes.includes(nextRow.lane),
    );
    // Suppress the branch→main rejoin curve only when the next row is a merge whose
    // merge parent on THIS lane is actually this row (that connection is drawn by the
    // merge block). For back-to-back merges this row may share the lane without being
    // the merge parent, in which case the rejoin curve must still be drawn.
    const isMergeParentOfNext = Boolean(
      nextRow &&
        nextRow.mergeLanes.includes(row.lane) &&
        mergeParentRowIndex(rowIndex + 1, row.lane, rows) === rowIndex,
    );
    const branchFromChildAbove = Boolean(
      prevRow && prevRow.lane !== row.lane,
    );
    const childRowIsMerge = Boolean(prevRow && prevRow.mergeLanes.length > 0);
    /**
     * Mainline commit right after a branch block: the rejoin curve is emitted by the
     * branch row's `branchFromParentBelow` block below, so suppress the child-above curve here
     * to avoid a duplicate (and the historical row-14 back-connection).
     */
    const mainRejoinFromBranch = Boolean(row.lane === 0 && prevRow && prevRow.lane > 0);

    if (branchFromChildAbove && prevRow && !childRowIsMerge && !mainRejoinFromBranch) {
      const d = curveBetweenCommits(
        laneCenterX(row.lane),
        yCenter,
        laneCenterX(prevRow.lane),
        rowCenter(rowIndex - 1),
      );
      if (d) {
        builder.appendCurve(d);
      }
    }

    // Branch row → rounded curve into the mainline commit node directly below (lane 0).
    const parentOnMainBelow = Boolean(nextRow && nextRow.lane === 0);
    if (
      branchFromParentBelow &&
      nextRow &&
      parentOnMainBelow &&
      row.mergeLanes.length === 0 &&
      !parentLaneIsMergeParent &&
      !isMergeParentOfNext
    ) {
      const d = curveBetweenCommits(
        laneCenterX(nextRow.lane),
        rowCenter(rowIndex + 1),
        laneCenterX(row.lane),
        yCenter,
      );
      if (d) {
        builder.appendCurve(d);
      }
    }

    for (const lane of activeLanesForRow(row)) {
      const x = laneCenterX(lane);
      const isCommitLane = lane === row.lane;
      const isMergeLane = mergeLanes.has(lane);
      const fromAbove = laneContinuesAbove(rowIndex, lane, rows);
      const toBelow = laneContinuesBelow(rowIndex, lane, rows);

      if (isMergeLane) {
        const xCommit = laneCenterX(row.lane);
        const parentIdx = mergeParentRowIndex(rowIndex, lane, rows);

        if (parentIdx !== undefined) {
          const parentRow = rows[parentIdx]!;
          const xParent = laneCenterX(parentRow.lane);
          const mergeToParent = curveBetweenCommits(
            xCommit,
            yCenter,
            xParent,
            rowCenter(parentIdx),
          );
          if (mergeToParent) {
            builder.appendCurve(mergeToParent);
          }
        } else {
          const entry = curveBetweenCommits(x, yTop, xCommit, yCenter);
          if (entry) {
            builder.appendCurve(entry);
          }
          if (toBelow) {
            pushVertical(lane, x, yCenter, yBottom);
          }
        }
        continue;
      }

      if (isCommitLane) {
        // Connected from above by a merge curve (not a straight line) → no upward stub.
        const connectedFromAboveByCurve = Boolean(
          prevRow &&
            prevRow.mergeLanes.includes(lane) &&
            mergeParentRowIndex(rowIndex - 1, lane, rows) === rowIndex,
        );
        // Parent sits on the trunk below → connected downward by a rejoin curve.
        const rejoinsMainBelow = Boolean(nextRow && nextRow.lane === 0 && row.lane > 0);
        const drawAbove = fromAbove && !connectedFromAboveByCurve;
        const drawBelow = toBelow && !rejoinsMainBelow;
        const topY = drawAbove ? yTop : yCenter;
        const bottomY = drawBelow ? yBottom : yCenter;
        if (drawAbove || drawBelow) {
          pushVertical(lane, x, topY, bottomY);
        }
        continue;
      }

      const mergedIntoFromAbove = Boolean(
        prevRow &&
          prevRow.mergeLanes.includes(lane) &&
          mergeParentRowIndex(rowIndex - 1, lane, rows) === rowIndex,
      );

      // Passing lane: stop at row center only when a branch/merge curve leaves this lane on this row.
      const parentOnLaneBranches = Boolean(
        nextRow && nextRow.lane === lane && row.lane !== lane,
      );
      const childAboveBranchesFromLane = Boolean(
        prevRow && fromAbove && prevRow.lane !== lane,
      );

      if (fromAbove && toBelow && mergedIntoFromAbove) {
        pushVertical(lane, x, yTop, yCenter);
      } else if (fromAbove && toBelow) {
        pushVertical(lane, x, yTop, yBottom);
      } else {
        let yStart = yTop;
        let yEnd = toBelow ? yBottom : yCenter;
        if (childAboveBranchesFromLane) {
          yEnd = yCenter;
        }
        if (parentOnLaneBranches) {
          yStart = yCenter;
        }
        pushVertical(lane, x, yStart, yEnd);
      }
    }
  }

  const { verticals, curves } = builder.toPathLists();

  return (
    <>
      <svg
        width={graphWidth}
        height={height}
        className="pointer-events-none absolute left-0 top-0 shrink-0"
        aria-hidden
      >
        <g className="text-border/40">
          {verticals.map((d, index) => (
            d ? (
              <path
                key={`v-${index}`}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
            ) : null
          ))}
          {curves.map((d, index) => (
            d ? (
              <path
                key={`c-${index}`}
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
            ) : null
          ))}
        </g>
      </svg>
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{ width: graphWidth, height }}
        aria-hidden
      >
        {rows.map((row, rowIndex) => (
          <div
            key={row.commit.oid}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{
              left: laneCenterX(row.lane),
              top: rowCenter(rowIndex),
            }}
          >
            <PrConversationTimelineNode icon={GitCommit} size="compact" />
          </div>
        ))}
      </div>
    </>
  );
}

function CommitGraphRowDetail({ row }: { row: GitCommitGraphRow }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shortOid = row.commit.oid.slice(0, 7);

  const copySha = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(row.commit.oid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [row.commit.oid]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium leading-snug">{row.commit.subject}</p>
      <p className="text-[11px]">
        <span className="font-medium">{row.commit.author}</span>
        {" "}
        <span className="text-muted-foreground">{row.commit.authoredAt}</span>
      </p>
      {row.commit.refs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.commit.refs.map((ref) => (
            <span
              key={`${row.commit.oid}:${ref}`}
              className="rounded bg-primary/15 px-1 py-0 text-[10px]"
            >
              {ref}
            </span>
          ))}
        </div>
      ) : null}
      <div className="group inline-flex w-fit cursor-default items-center gap-2 text-[11px] hover:cursor-pointer">
        <button
          type="button"
          className="truncate border-0 bg-transparent p-0 text-left text-[11px] text-muted-foreground"
          title={row.commit.oid}
          onClick={() => void copySha()}
          aria-label={t("workspace.git.copySha")}
        >
          {shortOid}
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 border-0 bg-transparent p-0",
            "text-muted-foreground/55 transition-all duration-150",
            "hover:text-inherit focus-visible:text-inherit",
            copied
              ? "opacity-100 text-inherit"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
          onClick={() => void copySha()}
          aria-label={copied ? t("workspace.git.copiedSha") : t("workspace.git.copySha")}
        >
          {copied ? (
            <Check className="size-[11px]" aria-hidden />
          ) : (
            <Copy className="size-[11px]" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );
}

function CommitGraphRowWithHover({
  row,
  textInset,
}: {
  row: GitCommitGraphRow;
  textInset: number;
}) {
  const { onPointerEnter, isHighlighted } = useTooltipTriggerProps(row);

  const rowButton = (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center py-1 pr-2 text-left",
        isHighlighted ? "bg-muted/30" : "hover:bg-muted/30",
      )}
      data-commit-oid={row.commit.oid}
      onPointerEnter={onPointerEnter}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-foreground/80">
        {row.commit.subject}
      </span>
    </button>
  );

  return (
    <div
      className="relative min-w-0"
      style={{ minHeight: ROW_HEIGHT_PX, paddingLeft: textInset }}
    >
      <TooltipItem item={row}>{rowButton}</TooltipItem>
    </div>
  );
}

export function GitCommitGraph({
  history,
  loading,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  onAddCommitToSession,
  addCommitToSessionDisabled = false,
  error,
  className,
}: GitCommitGraphProps) {
  const { t } = useTranslation();

  const rows = history?.rows ?? [];
  const graphWidth = useMemo(() => computeGraphWidth(rows), [rows]);
  const commitByOid = useMemo(
    () => new Map(rows.map((row) => [row.commit.oid, row.commit])),
    [rows],
  );
  const rowsContainerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreInFlightRef = useRef(false);
  const [geometry, setGeometry] = useState<RowGeometry | null>(null);
  const [commitContextMenuTarget, setCommitContextMenuTarget] = useState<GitCommitRecord | null>(
    null,
  );
  const commitContextMenuTargetRef = useRef<GitCommitRecord | null>(null);
  const handleCommitContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest("[data-commit-oid]");
      if (!row) {
        return;
      }
      const oid = row.getAttribute("data-commit-oid");
      const commit = oid ? commitByOid.get(oid) : undefined;
      if (!commit) {
        return;
      }
      commitContextMenuTargetRef.current = commit;
      setCommitContextMenuTarget(commit);
    },
    [commitByOid],
  );

  useEffect(() => {
    if (!hasMore || !onLoadMore || loadingMore) {
      return;
    }
    const root = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        if (loadMoreInFlightRef.current || loadingMore) {
          return;
        }
        loadMoreInFlightRef.current = true;
        onLoadMore();
      },
      { root, rootMargin: "160px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore, rows.length]);

  useEffect(() => {
    if (!loadingMore) {
      loadMoreInFlightRef.current = false;
    }
  }, [loadingMore]);

  useLayoutEffect(() => {
    const container = rowsContainerRef.current;
    if (!container || rows.length === 0) {
      setGeometry(null);
      return;
    }
    const measure = (): void => {
      const children = Array.from(container.children) as HTMLElement[];
      const tops: number[] = [];
      const heights: number[] = [];
      const centers: number[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const el = children[i];
        const top = el ? el.offsetTop : i * ROW_HEIGHT_PX;
        const height = el ? el.offsetHeight : ROW_HEIGHT_PX;
        tops.push(top);
        heights.push(height);
        if (el) {
          const button = el.querySelector("button");
          if (button instanceof HTMLElement) {
            centers.push(top + button.offsetTop + button.offsetHeight / 2);
          } else {
            centers.push(top + height / 2);
          }
        } else {
          centers.push(top + height / 2);
        }
      }
      setGeometry((prev) => {
        const total = container.offsetHeight;
        if (
          prev &&
          prev.total === total &&
          prev.tops.length === tops.length &&
          prev.tops.every((v, i) => v === tops[i]) &&
          prev.heights.every((v, i) => v === heights[i]) &&
          prev.centers.every((v, i) => v === centers[i])
        ) {
          return prev;
        }
        return { tops, heights, centers, total };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const child of Array.from(container.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [rows]);

  if (loading) {
    return (
      <div className={cn("flex flex-1 items-center justify-center gap-2 p-4 text-xs text-muted-foreground", className)}>
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        {t("workspace.git.loadingHistory")}
      </div>
    );
  }

  if (history && !history.isRepository) {
    return (
      <p className={cn("p-3 text-xs text-muted-foreground", className)}>{t("workspace.git.noRepo")}</p>
    );
  }

  if (error) {
    return <p className={cn("p-3 text-xs text-destructive", className)}>{error}</p>;
  }

  if (rows.length === 0) {
    return <p className={cn("p-3 text-xs text-muted-foreground", className)}>{t("workspace.git.noHistory")}</p>;
  }

  const showLoadMoreFooter = hasMore || loadingMore;

  const graphBody = (
    <div
      className="relative min-w-0 pr-1"
      onContextMenuCapture={onAddCommitToSession ? handleCommitContextMenuCapture : undefined}
    >
      <CommitGraphGutter rows={rows} graphWidth={graphWidth} geometry={geometry} />
      <Tooltip<GitCommitGraphRow> getItemId={(row) => row.commit.oid}>
        <Tooltip.Zone ref={rowsContainerRef} className="relative">
          {rows.map((row, rowIndex) => (
            <CommitGraphRowWithHover
              key={row.commit.oid}
              row={row}
              textInset={textInsetForRow(row, rowIndex, rows)}
            />
          ))}
        </Tooltip.Zone>
        <TooltipContent
          appearance="detail"
          side="right"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="w-72 p-3"
        >
          {(activeRow) =>
            activeRow ? <CommitGraphRowDetail row={activeRow as GitCommitGraphRow} /> : null}
        </TooltipContent>
      </Tooltip>
      {showLoadMoreFooter ? (
        <div
          ref={loadMoreSentinelRef}
          className="flex min-h-10 items-center justify-center gap-2 py-2 text-xs text-muted-foreground"
        >
          {loadingMore ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {t("workspace.git.loadingMoreHistory")}
            </>
          ) : hasMore && onLoadMore ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onLoadMore}
            >
              {t("workspace.git.loadMoreHistory")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <ScrollArea ref={scrollAreaRef} className={cn("min-h-0 flex-1", className)}>
      {onAddCommitToSession ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{graphBody}</ContextMenuTrigger>
          <WorkspaceGitCommitContextMenuContent
            commit={commitContextMenuTarget}
            commitRef={commitContextMenuTargetRef}
            onAddToSession={onAddCommitToSession}
            addToSessionDisabled={addCommitToSessionDisabled}
          />
        </ContextMenu>
      ) : (
        graphBody
      )}
    </ScrollArea>
  );
}
