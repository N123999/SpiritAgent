import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestChangedFile, GitHubPullRequestFileStatus } from "@/types";

const CHANGED_FILE_CARD_CLASS =
  "overflow-hidden rounded-lg border border-border/50 bg-muted shadow-sm";

export function prChangedFileAnchorId(filename: string): string {
  return `pr-change-file-${encodeURIComponent(filename)}`;
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

function PrChangedFileCard({ file }: { file: GitHubPullRequestChangedFile }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mounted = useCollapsibleChildMount(open);
  const displayPath =
    file.status === "renamed" && file.previousFilename
      ? `${file.previousFilename} → ${file.filename}`
      : file.filename;

  return (
    <section
      id={prChangedFileAnchorId(file.filename)}
      className={cn(CHANGED_FILE_CARD_CLASS, "min-w-0 scroll-mt-2")}
    >
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-expanded={open}
          aria-label={
            open ? t("workspace.prChangesFileCollapse") : t("workspace.prChangesFileExpand")
          }
          onClick={() => setOpen((value) => !value)}
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

  if (loading && files.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{t("workspace.prChangesLoading")}</p>;
  }

  if (files.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>{t("workspace.prChangesEmpty")}</p>
    );
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-row gap-0", className)}>
      <aside
        className="hidden w-[min(40%,13rem)] shrink-0 flex-col border-r border-border/40 md:flex"
        aria-hidden
      >
        <ScrollArea className="h-full min-h-0 flex-1" type="auto">
          <ul className="py-1">
            {files.map((file) => (
              <li key={file.filename}>
                <span className="block truncate px-2 py-1 font-mono text-[11px] text-muted-foreground">
                  {file.filename}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </aside>
      <ScrollArea className="min-h-0 min-w-0 flex-1" type="always">
        <div className="space-y-3 p-1">
          {files.map((file) => (
            <PrChangedFileCard key={file.filename} file={file} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
