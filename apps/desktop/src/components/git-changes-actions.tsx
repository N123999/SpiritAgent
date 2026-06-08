import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ChevronDown, GitMerge, LoaderCircle, Upload } from "lucide-react";

import { ActionPopover, type ActionPopoverItem } from "@/components/ui/action-popover";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import {
  DESKTOP_GIT_ACTION_BTN,
  DESKTOP_GIT_ACTION_MENU_TRIGGER,
  DESKTOP_GIT_ACTION_SPLIT,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { buildGitChangesMenuItemIds } from "@/lib/git-changes-menu-items";
import { cn } from "@/lib/utils";
import type { GitChipAction, SubmitGitChipRequest } from "@/types";

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
        icon: <Upload className="size-3 shrink-0 opacity-80" aria-hidden />,
        label: input.labels.push,
        onSelect: input.onPush,
      };
    }
    return {
      id,
      icon: <GitMerge className="size-3 shrink-0 opacity-80" aria-hidden />,
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
  onGitChip(request: SubmitGitChipRequest): Promise<boolean>;
};

export function GitChangesActions({
  isRepository,
  hasChanges,
  needsPush,
  canMerge,
  gitBusy,
  mergeFlashMerged = false,
  pushDisabledTitle,
  onGitChip,
}: GitChangesActionsProps) {
  const { t } = useTranslation();

  const menuLabels = useMemo<GitChangesMenuLabels>(
    () => ({
      push: t("workspace.git.push"),
      merge: t("app.merge"),
      merged: t("app.merged"),
    }),
    [t],
  );

  const runGitChip = useCallback(
    (action: GitChipAction) => {
      void onGitChip({ action });
    },
    [onGitChip],
  );

  const menuItems = useMemo(
    () =>
      buildGitChangesMenuItems({
        needsPush,
        canMerge,
        mergeFlashMerged,
        labels: menuLabels,
        onPush: () => runGitChip("push"),
        onMerge: () => runGitChip("merge"),
      }),
    [canMerge, mergeFlashMerged, menuLabels, needsPush, runGitChip],
  );

  if (!isRepository) {
    return null;
  }

  const busyIcon = gitBusy ? (
    <LoaderCircle className="size-3 animate-spin" aria-hidden />
  ) : null;

  if (!hasChanges) {
    return (
      <ButtonGroup>
        <Button
          type="button"
          variant="default"
          size="xs"
          className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
          disabled={!needsPush || gitBusy}
          title={!needsPush ? pushDisabledTitle : undefined}
          onClick={() => runGitChip("push")}
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
        variant="default"
        size="xs"
        className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
        disabled={gitBusy}
        onClick={() => runGitChip("commit")}
      >
        {busyIcon}
        <span>{t("app.commit")}</span>
      </Button>
      {menuItems.length > 0 ? (
        <>
          <ButtonGroupSeparator className={DESKTOP_GIT_ACTION_SPLIT} />
          <ActionPopover
            ariaLabel={t("workspace.git.moreActions")}
            title={t("workspace.git.moreActions")}
            disabled={gitBusy}
            triggerVariant="default"
            triggerSize="xs"
            triggerIcon={<ChevronDown className="size-3" aria-hidden />}
            items={menuItems}
            triggerClassName={DESKTOP_GIT_ACTION_MENU_TRIGGER}
          />
        </>
      ) : null}
    </ButtonGroup>
  );
}
