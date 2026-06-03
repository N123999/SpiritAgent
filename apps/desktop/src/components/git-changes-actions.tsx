import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown, GitMerge, LoaderCircle, Upload } from "lucide-react";

import { ActionPopover, type ActionPopoverItem } from "@/components/ui/action-popover";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { DESKTOP_CHROME_COMMIT_BTN } from "@/lib/desktop-chrome";
import { buildGitChangesMenuItemIds } from "@/lib/git-changes-menu-items";
import { cn } from "@/lib/utils";

export type GitChangesMenuLabels = {
  push: string;
  merge: string;
  merged: string;
};

export function buildGitChangesMenuItems(input: {
  needsPush: boolean;
  canMerge: boolean;
  mergeFlashMerged?: boolean;
  labels: GitChangesMenuLabels;
  onPush: () => void;
  onMerge: () => void;
}): ActionPopoverItem[] {
  return buildGitChangesMenuItemIds({
    needsPush: input.needsPush,
    canMerge: input.canMerge,
  }).map((id) => {
    if (id === "push") {
      return {
        id,
        icon: <Upload className="size-3.5 shrink-0 opacity-80" aria-hidden />,
        label: input.labels.push,
        onSelect: input.onPush,
      };
    }
    return {
      id,
      icon: <GitMerge className="size-3.5 shrink-0 opacity-80" aria-hidden />,
      label: input.mergeFlashMerged ? input.labels.merged : input.labels.merge,
      onSelect: input.onMerge,
    };
  });
}

export type GitChangesActionsProps = {
  isRepository: boolean;
  hasChanges: boolean;
  needsPush: boolean;
  canMerge: boolean;
  gitBusy: boolean;
  mergeFlashMerged?: boolean;
  pushDisabledTitle?: string;
  onCommit: () => void;
  onPush: () => void;
  onMerge: () => void;
};

export function GitChangesActions({
  isRepository,
  hasChanges,
  needsPush,
  canMerge,
  gitBusy,
  mergeFlashMerged = false,
  pushDisabledTitle,
  onCommit,
  onPush,
  onMerge,
}: GitChangesActionsProps) {
  const { t } = useTranslation();

  const menuLabels = useMemo<GitChangesMenuLabels>(
    () => ({
      push: t("workspace.git.push"),
      merge: t("app.merge"),
      merged: "Merged",
    }),
    [t],
  );

  const menuItems = useMemo(
    () =>
      buildGitChangesMenuItems({
        needsPush,
        canMerge,
        mergeFlashMerged,
        labels: menuLabels,
        onPush,
        onMerge,
      }),
    [canMerge, mergeFlashMerged, menuLabels, needsPush, onMerge, onPush],
  );

  if (!isRepository) {
    return null;
  }

  const busyIcon = gitBusy ? (
    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
  ) : null;

  if (!hasChanges) {
    return (
      <ButtonGroup>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DESKTOP_CHROME_COMMIT_BTN}
          disabled={!needsPush || gitBusy}
          title={!needsPush ? pushDisabledTitle : undefined}
          onClick={onPush}
        >
          {busyIcon}
          <span>{t("workspace.git.push")}</span>
        </Button>
      </ButtonGroup>
    );
  }

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={DESKTOP_CHROME_COMMIT_BTN}
        disabled={gitBusy}
        onClick={onCommit}
      >
        {busyIcon}
        <span>{t("app.commit")}</span>
      </Button>
      {menuItems.length > 0 ? (
        <ActionPopover
          ariaLabel={t("workspace.git.moreActions")}
          title={t("workspace.git.moreActions")}
          disabled={gitBusy}
          triggerIcon={<ChevronDown className="size-3.5" aria-hidden />}
          items={menuItems}
          triggerClassName={cn(
            DESKTOP_CHROME_COMMIT_BTN,
            "size-7 w-7 rounded-l-none rounded-r-md p-0",
          )}
          contentClassName="text-xs"
        />
      ) : null}
    </ButtonGroup>
  );
}
