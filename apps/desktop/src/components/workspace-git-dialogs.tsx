import { useTranslation } from "react-i18next";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DesktopCommitMode, DesktopGitSnapshot } from "@/types";

const commitModeOptions: Array<{
  value: DesktopCommitMode;
  labelKey: string;
  hintKey: string;
}> = [
  {
    value: "commit",
    labelKey: "app.commit",
    hintKey: "app.commitHint",
  },
  {
    value: "commit-and-push",
    labelKey: "app.commitAndPush",
    hintKey: "app.commitAndPushHint",
  },
];

export type WorkspaceGitCommitDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  gitSnapshot?: DesktopGitSnapshot;
  commitMessageDraft: string;
  onCommitMessageDraftChange(value: string): void;
  commitMode: DesktopCommitMode;
  onCommitModeChange(mode: DesktopCommitMode): void;
  commitBusy: boolean;
  commitActionDisabled: boolean;
  runtimeError?: string;
  onSubmit(): void;
};

export function WorkspaceGitCommitDialog({
  open,
  onOpenChange,
  gitSnapshot,
  commitMessageDraft,
  onCommitMessageDraftChange,
  commitMode,
  onCommitModeChange,
  commitBusy,
  commitActionDisabled,
  runtimeError,
  onSubmit,
}: WorkspaceGitCommitDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t("app.commitChanges")}</DialogTitle>
          <DialogDescription>
            {gitSnapshot?.branch
              ? t("app.currentBranch", { branch: gitSnapshot.branch })
              : t("app.commitDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="grid gap-2">
            <Label htmlFor="git-tab-commit-message-input">{t("app.commitMessage")}</Label>
            <Textarea
              id="git-tab-commit-message-input"
              value={commitMessageDraft}
              onChange={(event) => onCommitMessageDraftChange(event.target.value)}
              placeholder={t("app.commitMessagePlaceholder")}
              className="min-h-28"
              autoComplete="off"
              disabled={commitBusy}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("app.mode")}</Label>
            <div
              role="tablist"
              aria-label={t("app.commitMode")}
              className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
            >
              {commitModeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={commitMode === option.value}
                  className={cn(
                    "rounded-md px-2.5 text-xs font-medium transition-colors",
                    commitMode === option.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  disabled={commitBusy}
                  onClick={() => onCommitModeChange(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(commitModeOptions.find((option) => option.value === commitMode)?.hintKey ?? "")}
            </p>
          </div>
          {runtimeError ? (
            <p className="text-sm leading-relaxed text-destructive">{runtimeError}</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={commitBusy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={commitActionDisabled || commitBusy}
          >
            {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {commitMode === "commit-and-push" ? t("app.commitAndPush") : t("app.commit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type WorkspaceGitMergeDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  gitSnapshot?: DesktopGitSnapshot;
  commitBusy: boolean;
  mergeActionDisabled: boolean;
  runtimeError?: string;
  onSubmit(): void;
};

export function WorkspaceGitMergeDialog({
  open,
  onOpenChange,
  gitSnapshot,
  commitBusy,
  mergeActionDisabled,
  runtimeError,
  onSubmit,
}: WorkspaceGitMergeDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t("app.mergeToDefaultBranch")}</DialogTitle>
          <DialogDescription>
            {gitSnapshot?.worktreeBranch && gitSnapshot?.defaultBranch
              ? t("app.mergeBranchDescription", {
                  from: gitSnapshot.worktreeBranch,
                  to: gitSnapshot.defaultBranch,
                })
              : t("app.mergeToDefaultBranchDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <p className="text-sm text-muted-foreground">{t("app.mergeWarning")}</p>
          {runtimeError && open ? (
            <p className="text-sm leading-relaxed text-destructive">{runtimeError}</p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={commitBusy}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSubmit}
            disabled={mergeActionDisabled || commitBusy}
          >
            {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("app.merge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
