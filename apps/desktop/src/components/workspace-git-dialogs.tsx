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
import type { DesktopGitSnapshot } from "@/types";

export type WorkspaceGitCommitDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  gitSnapshot?: DesktopGitSnapshot;
  commitMessageDraft: string;
  onCommitMessageDraftChange(value: string): void;
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
  commitBusy,
  commitActionDisabled,
  runtimeError,
  onSubmit,
}: WorkspaceGitCommitDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            {t("app.commit")}
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
