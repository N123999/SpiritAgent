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
import type { DesktopSnapshot } from "@/types";

export type BranchCheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchCheckoutBlockedByChanges: boolean;
  git: DesktopSnapshot["git"] | undefined;
  commitBusy: boolean;
  onCancel: () => void;
  onConfirmCheckout: () => void;
  onDiscardAndCheckout: () => void;
};

export function BranchCheckoutDialog({
  open,
  onOpenChange,
  branchCheckoutBlockedByChanges,
  git,
  commitBusy,
  onCancel,
  onConfirmCheckout,
  onDiscardAndCheckout,
}: BranchCheckoutDialogProps) {
  const { t } = useTranslation();
  const targetBranch = git?.selectedBranch ?? git?.branch ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {branchCheckoutBlockedByChanges ? t("app.cannotSwitchBranch") : t("app.switchBranch")}
          </DialogTitle>
          <DialogDescription>
            {branchCheckoutBlockedByChanges ? (
              <>
                {t("app.uncommittedChangesCannotSwitch", { branch: targetBranch })}
                {t("app.discardChangesWarning")}
              </>
            ) : (
              <>
                {t("app.willSwitchBranch", { branch: targetBranch })}
                {git?.hasChanges ? ` ${t("app.uncommittedChangesMayFail")}` : null}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={commitBusy}
          >
            {t("common.cancel")}
          </Button>
          {branchCheckoutBlockedByChanges ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onDiscardAndCheckout}
              disabled={commitBusy}
            >
              {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("app.discardAndSwitch")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onConfirmCheckout}
              disabled={commitBusy}
            >
              {commitBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("app.switchAndSend")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
