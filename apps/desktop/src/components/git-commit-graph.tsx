import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Copy, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { GitCommitGraphRow, GitHistorySnapshot } from "@/types";

const ROW_HEIGHT_PX = 32;
const LANE_WIDTH_PX = 16;
const GUTTER_LEADING_PX = 4;
const NODE_RADIUS_PX = 4;
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

/** Keep message column clear of side lanes on this row and immediate neighbors. */
function textLaneForRow(
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
  return maxLane;
}

function rowTextInsetPx(
  row: GitCommitGraphRow,
  rowIndex: number,
  rows: readonly GitCommitGraphRow[],
): number {
  const maxLane = textLaneForRow(row, rowIndex, rows);
  return Math.ceil(laneCenterX(maxLane) + NODE_RADIUS_PX + TEXT_GAP_PX);
}

function computeGraphWidth(rows: readonly GitCommitGraphRow[]): number {
  return rows.reduce(
    (max, row, rowIndex) => Math.max(max, rowTextInsetPx(row, rowIndex, rows)),
    0,
  );
}

export type GitCommitGraphProps = {
  history: GitHistorySnapshot | null;
  loading: boolean;
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

type RowGeometry = { tops: number[]; heights: number[]; total: number };

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
  const rowCenter = (i: number): number => rowTop(i) + rowHeight(i) / 2;
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
    const mergeOnNextTargetsThisLane = Boolean(
      nextRow && nextRow.mergeLanes.includes(row.lane),
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
      !mergeOnNextTargetsThisLane
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
    <svg
      width={graphWidth}
      height={height}
      className="pointer-events-none absolute left-0 top-0 shrink-0 text-muted-foreground/70"
      aria-hidden
    >
      {verticals.map((d, index) => (
        d ? (
          <path
            key={`v-${index}`}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
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
            strokeWidth={1.5}
            strokeLinecap="butt"
            strokeLinejoin="round"
          />
        ) : null
      ))}
      {rows.map((row, rowIndex) => (
        <circle
          key={row.commit.oid}
          cx={laneCenterX(row.lane)}
          cy={rowCenter(rowIndex)}
          r={NODE_RADIUS_PX}
          className="fill-foreground stroke-background"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

function CommitGraphRow({
  row,
  textInset,
}: {
  row: GitCommitGraphRow;
  textInset: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className="relative min-w-0 border-b border-border/20 last:border-b-0"
        style={{ minHeight: ROW_HEIGHT_PX, paddingLeft: textInset }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-start py-1 pr-2 text-left hover:bg-muted/30"
          >
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-xs leading-snug text-foreground">{row.commit.subject}</span>
              {row.commit.refs.length > 0 ? (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {row.commit.refs.map((ref) => (
                    <span
                      key={`${row.commit.oid}:${ref}`}
                      className="rounded bg-primary/15 px-1 py-0 font-mono text-[10px] text-primary"
                    >
                      {ref}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-72 p-3"
      >
        <div className="space-y-2">
          <p className="text-sm font-medium leading-snug text-foreground">{row.commit.subject}</p>
          <p className="text-[11px] text-muted-foreground">
            <span className="text-foreground/80">{row.commit.author}</span>
            {" · "}
            <span>{row.commit.authoredAt}</span>
          </p>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="truncate" title={row.commit.oid}>
              {shortOid}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={() => void copySha()}
              aria-label={t("workspace.git.copySha")}
            >
              <Copy className="size-3" aria-hidden />
            </Button>
            {copied ? <span className="text-[10px] text-foreground">{t("workspace.git.copiedSha")}</span> : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function GitCommitGraph({ history, loading, error, className }: GitCommitGraphProps) {
  const { t } = useTranslation();

  const rows = history?.rows ?? [];
  const graphWidth = useMemo(() => computeGraphWidth(rows), [rows]);
  const rowsContainerRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<RowGeometry | null>(null);

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
      for (let i = 0; i < rows.length; i += 1) {
        const el = children[i];
        tops.push(el ? el.offsetTop : i * ROW_HEIGHT_PX);
        heights.push(el ? el.offsetHeight : ROW_HEIGHT_PX);
      }
      setGeometry((prev) => {
        const total = container.offsetHeight;
        if (
          prev &&
          prev.total === total &&
          prev.tops.length === tops.length &&
          prev.tops.every((v, i) => v === tops[i]) &&
          prev.heights.every((v, i) => v === heights[i])
        ) {
          return prev;
        }
        return { tops, heights, total };
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

  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      <div className="relative min-w-0 pr-1">
        <CommitGraphGutter rows={rows} graphWidth={graphWidth} geometry={geometry} />
        <div className="relative" ref={rowsContainerRef}>
          {rows.map((row) => (
            <CommitGraphRow key={row.commit.oid} row={row} textInset={graphWidth} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
