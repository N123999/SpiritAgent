import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { LoaderCircle } from "lucide-react";

import { GitChangesActions } from "@/components/git-changes-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { workspaceExplorerIcon } from "@/components/workspace-files-panel";
import { cn } from "@/lib/utils";
import type { DesktopGitSnapshot, GitWorkingTreeChange, GitWorkingTreeSnapshot } from "@/types";

export type GitChangesSectionProps = {
  gitSnapshot?: DesktopGitSnapshot;
  workingTree: GitWorkingTreeSnapshot | null;
  loading: boolean;
  error?: string;
  hasChanges?: boolean;
  needsPush?: boolean;
  canMerge?: boolean;
  gitBusy?: boolean;
  mergeFlashMerged?: boolean;
  pushDisabledTitle?: string;
  onCommit?: () => void;
  onPush?: () => void;
  onMerge?: () => void;
  onOpenChangedFile?: (relativePath: string) => void;
  className?: string;
  style?: CSSProperties;
};

function statusCodeClass(code: string): string {
  if (code.includes("?")) {
    return "text-muted-foreground";
  }
  if (code.includes("D")) {
    return "text-destructive";
  }
  if (code.includes("A")) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-amber-600 dark:text-amber-400";
}

function splitChangePath(path: string): { fileName: string; dirLabel: string } {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) {
    return { fileName: normalized, dirLabel: "" };
  }
  return {
    fileName: normalized.slice(slash + 1),
    dirLabel: `${normalized.slice(0, slash)}/`,
  };
}

function ChangeRow({
  change,
  onOpen,
}: {
  change: GitWorkingTreeChange;
  onOpen?: (relativePath: string) => void;
}) {
  const { fileName, dirLabel } = splitChangePath(change.path);
  const Icon = workspaceExplorerIcon(fileName, "file");
  const statusLabel = change.code.trim() || "·";
  const clickable = Boolean(onOpen);

  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={!clickable}
        className={cn(
          "flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left text-xs",
          clickable && "cursor-pointer hover:bg-muted/30",
        )}
        title={change.path}
        onClick={() => onOpen?.(change.path)}
      >
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 truncate text-foreground/90">{fileName}</span>
          {dirLabel ? (
            <span className="min-w-0 truncate text-[10px] text-muted-foreground">{dirLabel}</span>
          ) : null}
        </div>
        <span
          className={cn(
            "ml-1 shrink-0 font-mono text-[10px] font-medium tabular-nums",
            statusCodeClass(change.code),
          )}
          title={change.code}
        >
          {statusLabel}
        </span>
      </button>
    </li>
  );
}

export function GitChangesSection({
  gitSnapshot,
  workingTree,
  loading,
  error,
  hasChanges = false,
  needsPush = false,
  canMerge = false,
  gitBusy = false,
  mergeFlashMerged = false,
  pushDisabledTitle,
  onCommit,
  onPush,
  onMerge,
  onOpenChangedFile,
  className,
  style,
}: GitChangesSectionProps) {
  const { t } = useTranslation();
  const isRepository = gitSnapshot?.isRepository === true && workingTree?.isRepository !== false;
  const changes = workingTree?.changes ?? [];
  const branchLabel = gitSnapshot?.branch ?? gitSnapshot?.worktreeBranch;

  return (
    <section className={cn("flex min-h-0 flex-col", className)} style={style}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5">
        <h3 className="text-xs font-medium text-foreground">{t("workspace.git.changes")}</h3>
        <div className="flex min-w-0 items-center gap-1">
          {branchLabel ? (
            <span className="max-w-[7rem] truncate font-mono text-[10px] text-muted-foreground">
              {branchLabel}
            </span>
          ) : null}
          <GitChangesActions
            isRepository={isRepository}
            hasChanges={hasChanges}
            needsPush={needsPush}
            canMerge={canMerge}
            gitBusy={gitBusy}
            mergeFlashMerged={mergeFlashMerged}
            pushDisabledTitle={pushDisabledTitle}
            onCommit={() => onCommit?.()}
            onPush={() => onPush?.()}
            onMerge={() => onMerge?.()}
          />
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            {t("workspace.git.loadingChanges")}
          </div>
        ) : null}
        {!loading && !isRepository ? (
          <p className="p-3 text-xs text-muted-foreground">{t("workspace.git.noRepo")}</p>
        ) : null}
        {!loading && isRepository && error ? (
          <p className="p-3 text-xs text-destructive">{error}</p>
        ) : null}
        {!loading && isRepository && !error && changes.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("workspace.git.noChanges")}</p>
        ) : null}
        {!loading && isRepository && !error && changes.length > 0 ? (
          <ScrollArea className="h-full min-h-0">
            <ul className="py-1">
              {changes.map((change) => (
                <ChangeRow
                  key={`${change.code}:${change.path}`}
                  change={change}
                  onOpen={onOpenChangedFile}
                />
              ))}
            </ul>
          </ScrollArea>
        ) : null}
      </div>
    </section>
  );
}
