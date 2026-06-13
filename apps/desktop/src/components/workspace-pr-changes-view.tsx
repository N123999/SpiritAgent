import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import { WorkspacePrChangesFileTree } from "@/components/workspace-pr-changes-file-tree";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { buildPrChangedFilesTree } from "@/lib/pr-changed-files-tree";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestChangedFile, GitHubPullRequestFileStatus } from "@/types";

const CHANGED_FILE_CARD_CLASS =
  "overflow-hidden rounded-lg border border-border/50 bg-muted shadow-sm";

export function prChangedFileAnchorId(filename: string): string {
  return `pr-change-file-${encodeURIComponent(filename)}`;
}

function scrollAreaViewport(root: ComponentRef<typeof ScrollArea> | null): HTMLElement | null {
  return root?.querySelector("[data-radix-scroll-area-viewport]") ?? null;
}

function fileStatusLabelKey(status: GitHubPullRequestFileStatus): string {
  switch (status) {
    case "added":
      return "workspace.prFileStatusAdded";
    case "removed":
      return "workspace.prFileStatusRemoved";
    case "renamed":
      return "workspace.prFileStatusRenamed";
    case "copied":
      return "workspace.prFileStatusCopied";
    default:
      return "workspace.prFileStatusModified";
  }
}

function PrChangedFileCard({
  file,
  open,
  onOpenChange,
}: {
  file: GitHubPullRequestChangedFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const mounted = useCollapsibleChildMount(open);
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
        <div className="sticky top-0 z-10 border-b border-border/40 bg-muted">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
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
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65">
              {displayPath}
            </span>
            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
              {t(fileStatusLabelKey(file.status))}
            </Badge>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              +{file.additions} −{file.deletions}
            </span>
          </button>
        </div>
        <CollapsibleContent>
          {mounted ? (
            file.patch ? (
              <ReviewCommentHunkView
                path={file.filename}
                diffHunk={file.patch}
                surface="card"
                layout="embedded"
              />
            ) : (
              <p className="border-t border-border/20 px-3 py-2 text-xs text-muted-foreground">
                {t("workspace.prChangesNoPatch")}
              </p>
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
  className?: string;
};

export function WorkspacePrChangesView({
  files,
  loading = false,
  className,
}: WorkspacePrChangesViewProps) {
  const { t } = useTranslation();
  const cardsScrollRef = useRef<ComponentRef<typeof ScrollArea>>(null);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [expandedFilenames, setExpandedFilenames] = useState<Set<string>>(() => new Set());

  const treeNodes = useMemo(() => buildPrChangedFilesTree(files), [files]);

  const navigateToFile = useCallback((filename: string) => {
    setSelectedFilename(filename);
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

  useEffect(() => {
    const viewport = scrollAreaViewport(cardsScrollRef.current);
    if (!viewport || files.length === 0) {
      return;
    }

    const sections = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-pr-changed-file]"),
    );
    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const filename = visible?.target.getAttribute("data-pr-changed-file");
        if (filename) {
          setSelectedFilename(filename);
        }
      },
      {
        root: viewport,
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const section of sections) {
      observer.observe(section);
    }

    return () => observer.disconnect();
  }, [files]);

  if (loading && files.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>{t("workspace.prChangesLoading")}</p>
    );
  }

  if (files.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>{t("workspace.prChangesEmpty")}</p>
    );
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-row gap-0", className)}>
      <aside className="flex w-[min(40%,13rem)] shrink-0 flex-col border-r border-border/40">
        <ScrollArea className="h-full min-h-0 flex-1" type="auto">
          <WorkspacePrChangesFileTree
            nodes={treeNodes}
            selectedFilename={selectedFilename}
            onSelectFile={navigateToFile}
          />
        </ScrollArea>
      </aside>
      <ScrollArea ref={cardsScrollRef} className="min-h-0 min-w-0 flex-1" type="always">
        <div className="space-y-3 p-1">
          {files.map((file) => (
            <PrChangedFileCard
              key={file.filename}
              file={file}
              open={expandedFilenames.has(file.filename)}
              onOpenChange={(nextOpen) => {
                setExpandedFilenames((previous) => {
                  const next = new Set(previous);
                  if (nextOpen) {
                    next.add(file.filename);
                    setSelectedFilename(file.filename);
                  } else {
                    next.delete(file.filename);
                  }
                  return next;
                });
              }}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
