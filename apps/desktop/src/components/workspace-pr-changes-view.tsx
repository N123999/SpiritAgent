import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { WorkspacePrChangesFileTree } from "@/components/workspace-pr-changes-file-tree";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { buildPrChangedFilesTree } from "@/lib/pr-changed-files-tree";
import {
  PR_CHANGES_TREE_MIN_WIDTH_PX,
  computePrChangesTreeMaxWidthPx,
  readPrChangesTreeWidthPx,
  writePrChangesTreeWidthPx,
} from "@/lib/layout-prefs";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestChangedFile } from "@/types";

const CHANGED_FILE_CARD_CLASS =
  "rounded-lg border border-border/60 bg-background";

export function prChangedFileAnchorId(filename: string): string {
  return `pr-change-file-${encodeURIComponent(filename)}`;
}

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

function PrChangedFileCard({
  file,
  open,
  onOpenChange,
  onOpenExternal,
}: {
  file: GitHubPullRequestChangedFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenExternal?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const mounted = useCollapsibleChildMount(open);
  const showExpandedChrome = open || mounted;
  const displayPath =
    file.status === "renamed" && file.previousFilename
      ? `${file.previousFilename} → ${file.filename}`
      : file.filename;

  return (
    <section
      id={prChangedFileAnchorId(file.filename)}
      className={cn(CHANGED_FILE_CARD_CLASS, "min-w-0 scroll-mt-0")}
      data-pr-changed-file={file.filename}
    >
      <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0">
        <div
          className={cn(
            "sticky top-0 z-10 bg-background",
            showExpandedChrome
              ? "rounded-t-lg border-b border-border/40"
              : "overflow-hidden rounded-lg",
          )}
        >
          <button
            type="button"
            className={cn(
              "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left outline-none cursor-pointer",
              "hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/60",
            )}
            aria-expanded={open}
            aria-label={
              open ? t("workspace.prChangesFileCollapse") : t("workspace.prChangesFileExpand")
            }
            onClick={() => onOpenChange(!open)}
          >
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
                open && "rotate-90",
              )}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span className="min-w-0 truncate text-xs text-foreground">{displayPath}</span>
              <EditFileLineDeltaBadge
                delta={{ added: file.additions, removed: file.deletions }}
                className="font-normal"
              />
            </div>
          </button>
        </div>
        <CollapsibleContent className={cn(showExpandedChrome && "rounded-b-lg")}>
          {mounted ? (
            file.patch ? (
              <ReviewCommentHunkView
                path={file.filename}
                diffHunk={file.patch}
                layout="embedded"
              />
            ) : (
              <div className="space-y-2 border-t border-border/20 px-3 py-2 text-xs text-muted-foreground">
                <p>{t("workspace.prChangesNoPatch")}</p>
                {file.blobUrl && onOpenExternal ? (
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2 hover:text-foreground/80"
                    onClick={() => onOpenExternal(file.blobUrl!)}
                  >
                    {t("workspace.prChangesViewOnGitHub")}
                  </button>
                ) : null}
              </div>
            )
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export type WorkspacePrChangesViewProps = {
  files: GitHubPullRequestChangedFile[];
  loading?: boolean;
  hasMore?: boolean;
  onOpenExternal?: (url: string) => void;
  className?: string;
};

export function WorkspacePrChangesView({
  files,
  loading = false,
  hasMore = false,
  onOpenExternal,
  className,
}: WorkspacePrChangesViewProps) {
  const { t } = useTranslation();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const treeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestTreeWidthPxRef = useRef(readPrChangesTreeWidthPx());
  const [treeWidthPx, setTreeWidthPx] = useState(() => readPrChangesTreeWidthPx());
  const [isResizingTree, setIsResizingTree] = useState(false);
  const [containerWidthPx, setContainerWidthPx] = useState(0);
  const [expandedFilenames, setExpandedFilenames] = useState<Set<string>>(() => new Set());

  const treeNodes = useMemo(() => buildPrChangedFilesTree(files), [files]);

  latestTreeWidthPxRef.current = treeWidthPx;

  const maxTreeWidthPx = useMemo(
    () =>
      containerWidthPx > 0
        ? computePrChangesTreeMaxWidthPx(containerWidthPx)
        : computePrChangesTreeMaxWidthPx(1200),
    [containerWidthPx],
  );

  const clampTreeWidth = useCallback(
    (value: number) => Math.min(maxTreeWidthPx, Math.max(PR_CHANGES_TREE_MIN_WIDTH_PX, value)),
    [maxTreeWidthPx],
  );

  useEffect(() => {
    const container = splitContainerRef.current;
    if (!container) {
      return;
    }
    const syncContainerWidth = () => {
      setContainerWidthPx(container.clientWidth);
    };
    syncContainerWidth();
    const observer = new ResizeObserver(syncContainerWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, [files.length]);

  useEffect(() => {
    if (treeWidthPx <= maxTreeWidthPx) {
      return;
    }
    setTreeWidthPx(clampTreeWidth(treeWidthPx));
  }, [clampTreeWidth, maxTreeWidthPx, treeWidthPx]);

  const onTreeResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsResizingTree(true);
      treeDragRef.current = { startX: event.clientX, startWidth: treeWidthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [treeWidthPx],
  );

  const onTreeResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = treeDragRef.current;
      if (!drag) {
        return;
      }
      const delta = event.clientX - drag.startX;
      const next = clampTreeWidth(drag.startWidth + delta);
      latestTreeWidthPxRef.current = next;
      setTreeWidthPx(next);
    },
    [clampTreeWidth],
  );

  const endTreeResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setIsResizingTree(false);
    if (treeDragRef.current) {
      const containerWidth = splitContainerRef.current?.clientWidth ?? 0;
      writePrChangesTreeWidthPx(
        latestTreeWidthPxRef.current,
        containerWidth > 0 ? containerWidth : undefined,
      );
    }
    treeDragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  }, []);

  const navigateToFile = useCallback((filename: string) => {
    setExpandedFilenames((previous) => {
      const next = new Set(previous);
      next.add(filename);
      return next;
    });

    requestAnimationFrame(() => {
      const viewport = scrollAreaViewport(cardsScrollRef.current);
      const section = viewport?.querySelector<HTMLElement>(
        `[data-pr-changed-file="${CSS.escape(filename)}"]`,
      );
      section?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }, []);

  if (loading && files.length === 0) {
    return (
      <p className={cn("px-3 pt-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChangesLoading")}
      </p>
    );
  }

  if (files.length === 0) {
    return (
      <p className={cn("px-3 pt-3 text-xs text-muted-foreground", className)}>
        {t("workspace.prChangesEmpty")}
      </p>
    );
  }

  return (
    <div
      ref={splitContainerRef}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-hidden",
        isResizingTree && "select-none",
        className,
      )}
    >
      <aside
        className="flex min-h-0 shrink-0 flex-col border-r border-border/40"
        style={{ width: treeWidthPx }}
      >
        <ScrollArea className="h-full min-h-0 flex-1" type="auto">
          <WorkspacePrChangesFileTree
            nodes={treeNodes}
            onSelectFile={navigateToFile}
          />
        </ScrollArea>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("workspace.prChangesResizeTreeWidth")}
        className={cn(
          "group relative z-10 -ml-px w-1 shrink-0 cursor-col-resize touch-none select-none self-stretch",
          "before:absolute before:inset-y-0 before:-right-1 before:w-3 before:content-['']",
        )}
        onPointerDown={onTreeResizePointerDown}
        onPointerMove={onTreeResizePointerMove}
        onPointerUp={endTreeResize}
        onPointerCancel={endTreeResize}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-border/55"
          aria-hidden
        />
      </div>
      <ScrollArea
        ref={cardsScrollRef}
        className="min-h-0 min-w-0 flex-1 pr-1"
        type="always"
      >
        <div className="space-y-3 p-1">
          {files.map((file) => (
            <PrChangedFileCard
              key={file.filename}
              file={file}
              open={expandedFilenames.has(file.filename)}
              onOpenExternal={onOpenExternal}
              onOpenChange={(nextOpen) => {
                setExpandedFilenames((previous) => {
                  const next = new Set(previous);
                  if (nextOpen) {
                    next.add(file.filename);
                  } else {
                    next.delete(file.filename);
                  }
                  return next;
                });
              }}
            />
          ))}
          {hasMore ? (
            <p className="px-1 text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
              {t("workspace.prChangesHasMore")}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
