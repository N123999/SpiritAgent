import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
} from "@/components/text-selection-action-menu";
import { EditFileLineDeltaBadge } from "@/components/edit-file-line-delta-badge";
import { WorkspacePrChangesFileTree } from "@/components/workspace-pr-changes-file-tree";
import { AnimatedCollapse, AnimatedCollapseContent } from "@/components/ui/animated-collapse";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { useTextSelectionActionMenu } from "@/hooks/use-text-selection-action-menu";
import { buildPrChangedFilesTree } from "@/lib/pr-changed-files-tree";
import type { PrDiffAttachment, PullRequestChipStatus } from "@/lib/pr-diff-attachment";
import { buildPrDiffSnippetFromPatch, buildPrDiffSnippetText } from "@/lib/pr-diff-text";
import { inferLineRangeFromPatch } from "@/lib/pr-diff-patch-slice";
import { readDiffSelectionText, resolveChangedFileFromSelection, resolveDiffSelectionLineRange } from "@/lib/pr-diff-selection";
import {
  PR_CHANGES_TREE_MIN_WIDTH_PX,
  computePrChangesTreeMaxWidthPx,
  readPrChangesTreeWidthPx,
  writePrChangesTreeWidthPx,
} from "@/lib/layout-prefs";
import { useWorkspaceToolsShellRowDividers } from "@/lib/use-workspace-tools-shell-row-dividers";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestChangedFile } from "@/types";

export function prChangedFileAnchorId(filename: string): string {
  return `pr-change-file-${encodeURIComponent(filename)}`;
}

function findDiffRootFromSelection(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.classList.contains("tool-call-diff")) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function isDiffCodeSelection(selection: Selection, root: HTMLElement): boolean {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (!anchor || !focus) {
    return false;
  }
  const diffRoot =
    findDiffRootFromSelection(anchor, root) ?? findDiffRootFromSelection(focus, root);
  if (!diffRoot) {
    return false;
  }
  const isInDiffCode = (node: Node | null): boolean => {
    let current: Node | null = node;
    while (current && current !== diffRoot) {
      if (current instanceof HTMLElement && current.classList.contains("diff-code")) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  };
  return isInDiffCode(anchor) && isInDiffCode(focus)
    && resolveChangedFileFromSelection(selection, root) != null;
}

function PrChangesSelectionMenu({
  rootRef,
  files,
  prUrl,
  prStatus,
  onPrDiffAddToSession,
}: {
  rootRef: RefObject<HTMLElement | null>;
  files: GitHubPullRequestChangedFile[];
  prUrl: string;
  prStatus: PullRequestChipStatus;
  onPrDiffAddToSession?: (attachment: PrDiffAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onPrDiffAddToSession && prUrl);
  const { open, setOpen, anchor, dismiss } = useTextSelectionActionMenu({
    enabled,
    rootRef,
    isSelectionAllowed: isDiffCodeSelection,
  });

  const handleAddToSession = useCallback(() => {
    const root = rootRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !selection || !onPrDiffAddToSession) {
      dismiss();
      return;
    }

    const filename = resolveChangedFileFromSelection(selection, root);
    if (!filename) {
      dismiss();
      return;
    }

    const diffRoot = findDiffRootFromSelection(selection.anchorNode, root);
    const selectedText = readDiffSelectionText(selection);
    if (!selectedText) {
      dismiss();
      return;
    }

    const filePatch = files.find((file) => file.filename === filename)?.patch;
    const lineRange =
      (diffRoot ? resolveDiffSelectionLineRange(diffRoot, selection) : null)
      ?? (filePatch ? inferLineRangeFromPatch(filename, filePatch, selectedText) : null);
    const diffText =
      filePatch && lineRange
        ? buildPrDiffSnippetFromPatch(
            filename,
            filePatch,
            lineRange.lineStart,
            lineRange.lineEnd,
          )
        : buildPrDiffSnippetText(filename, selectedText);
    if (!diffText) {
      dismiss();
      return;
    }

    const attachment: PrDiffAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      prUrl,
      filename,
      lineStart: lineRange?.lineStart ?? 0,
      lineEnd: lineRange?.lineEnd ?? 0,
      diffText,
      status: prStatus,
    };
    onPrDiffAddToSession(attachment);
    dismiss();
    selection.removeAllRanges();
  }, [dismiss, files, onPrDiffAddToSession, prStatus, prUrl, rootRef]);

  if (!enabled) {
    return null;
  }

  return (
    <TextSelectionActionMenu open={open} anchor={anchor} onOpenChange={setOpen}>
      <TextSelectionActionMenuItem
        label={t("workspace.prAddDiffToSession")}
        onSelect={handleAddToSession}
      />
    </TextSelectionActionMenu>
  );
}

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

/** Matches composer-surface backdrop (without border/radius). */
const PR_STICKY_PINNED_BACKDROP_CLASS =
  "bg-background/55 backdrop-blur-xl dark:bg-input/30 supports-[backdrop-filter]:bg-background/40 dark:supports-[backdrop-filter]:bg-input/25";

function useStickyHeaderPinned(
  sentinelRef: RefObject<HTMLElement | null>,
  getScrollViewport: () => HTMLElement | null,
  enabled: boolean,
) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPinned(false);
      return;
    }

    const sentinel = sentinelRef.current;
    const root = getScrollViewport();
    if (!sentinel || !root) {
      setPinned(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPinned(!entry.isIntersecting);
      },
      { root, threshold: [0] },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, getScrollViewport, sentinelRef]);

  return pinned;
}

function PrChangedFileHeaderButton({
  displayPath,
  open,
  additions,
  deletions,
  onToggle,
}: {
  displayPath: string;
  open: boolean;
  additions: number;
  deletions: number;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 px-3 py-3 text-left outline-none cursor-pointer",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
      )}
      aria-expanded={open}
      aria-label={open ? t("workspace.prChangesFileCollapse") : t("workspace.prChangesFileExpand")}
      onClick={onToggle}
    >
      <ChevronRight
        className={cn(
          "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
          open && "rotate-90",
        )}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="min-w-0 truncate text-xs leading-relaxed text-foreground">{displayPath}</span>
        <EditFileLineDeltaBadge
          delta={{ added: additions, removed: deletions }}
          className="font-normal"
        />
      </div>
    </button>
  );
}

function PrChangedFileCard({
  file,
  open,
  onOpenChange,
  onOpenExternal,
  getScrollViewport,
}: {
  file: GitHubPullRequestChangedFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenExternal?: (url: string) => void;
  getScrollViewport: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  const mounted = useCollapsibleChildMount(open);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const showExpandedChrome = open || mounted;
  const pinned = useStickyHeaderPinned(stickySentinelRef, getScrollViewport, showExpandedChrome);
  const displayPath =
    file.status === "renamed" && file.previousFilename
      ? `${file.previousFilename} → ${file.filename}`
      : file.filename;

  return (
    <section
      id={prChangedFileAnchorId(file.filename)}
      className="min-w-0 scroll-mt-0"
      data-pr-changed-file={file.filename}
    >
      <AnimatedCollapse open={open} onOpenChange={onOpenChange} className="min-w-0">
        {showExpandedChrome ? (
          <div
            ref={stickySentinelRef}
            className="pointer-events-none h-px w-full shrink-0 -mb-px"
            aria-hidden
          />
        ) : null}
        <div
          className={cn(
            "relative",
            showExpandedChrome && "sticky top-0 z-10",
            showExpandedChrome &&
              "shadow-[inset_0_-1px_0_0_color-mix(in_oklab,var(--border)_40%,transparent)]",
            showExpandedChrome && pinned ? PR_STICKY_PINNED_BACKDROP_CLASS : "bg-transparent",
          )}
        >
          <PrChangedFileHeaderButton
            displayPath={displayPath}
            open={open}
            additions={file.additions}
            deletions={file.deletions}
            onToggle={() => onOpenChange(!open)}
          />
        </div>
        <AnimatedCollapseContent>
          {mounted ? (
            file.patch ? (
              <ReviewCommentHunkView
                path={file.filename}
                diffHunk={file.patch}
                layout="embedded"
              />
            ) : (
              <div className="space-y-2 px-3 pb-3 text-xs text-muted-foreground">
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
        </AnimatedCollapseContent>
      </AnimatedCollapse>
    </section>
  );
}

export type WorkspacePrChangesViewProps = {
  files: GitHubPullRequestChangedFile[];
  loading?: boolean;
  hasMore?: boolean;
  prUrl?: string;
  prStatus?: PullRequestChipStatus;
  onPrDiffAddToSession?: (attachment: PrDiffAttachment) => void;
  onOpenExternal?: (url: string) => void;
  className?: string;
};

export function WorkspacePrChangesView({
  files,
  loading = false,
  hasMore = false,
  prUrl = "",
  prStatus = "open",
  onPrDiffAddToSession,
  onOpenExternal,
  className,
}: WorkspacePrChangesViewProps) {
  const { t } = useTranslation();
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const cardsScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const cardsListRef = useRef<HTMLDivElement>(null);
  const treeAsideRef = useRef<HTMLElement>(null);
  const treeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const latestTreeWidthPxRef = useRef(readPrChangesTreeWidthPx());
  const [treeWidthPx, setTreeWidthPx] = useState(() => readPrChangesTreeWidthPx());
  const [isResizingTree, setIsResizingTree] = useState(false);
  const [containerWidthPx, setContainerWidthPx] = useState(0);
  const [expandedFilenames, setExpandedFilenames] = useState<Set<string>>(() => new Set());

  const treeNodes = useMemo(() => buildPrChangedFilesTree(files), [files]);
  const showFileList = files.length > 0;

  const getCardsScrollViewport = useCallback(
    () => scrollAreaViewport(cardsScrollRef.current),
    [],
  );

  useWorkspaceToolsShellRowDividers(cardsListRef, [files.length, hasMore, expandedFilenames.size], {
    enabled: showFileList,
    trailingDivider: !hasMore,
    dividerAnchorRef: treeAsideRef,
    dividerAnchorEdge: "right",
    layoutWatchRef: treeAsideRef,
  });

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
        ref={treeAsideRef}
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
        className="min-h-0 min-w-0 flex-1"
        type="auto"
      >
        <div ref={cardsListRef}>
          {files.map((file) => (
            <PrChangedFileCard
              key={file.filename}
              file={file}
              open={expandedFilenames.has(file.filename)}
              onOpenExternal={onOpenExternal}
              getScrollViewport={getCardsScrollViewport}
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
            <p className="px-3 py-2 text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
              {t("workspace.prChangesHasMore")}
            </p>
          ) : null}
        </div>
      </ScrollArea>
      <PrChangesSelectionMenu
        rootRef={cardsListRef}
        files={files}
        prUrl={prUrl}
        prStatus={prStatus}
        onPrDiffAddToSession={onPrDiffAddToSession}
      />
    </div>
  );
}
