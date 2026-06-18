import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionItems,
  type ContextMenuSectionItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { GitCommitRecord } from "@/types";

export type WorkspaceGitCommitContextMenuProps = {
  commit: GitCommitRecord;
  onAddToSession?: (commit: GitCommitRecord) => void;
  addToSessionDisabled?: boolean;
  children: ReactNode;
};

export function WorkspaceGitCommitContextMenu({
  commit,
  onAddToSession,
  addToSessionDisabled = false,
  children,
}: WorkspaceGitCommitContextMenuProps) {
  const { t } = useTranslation();
  const menuItems: ContextMenuSectionItem[] = [];

  if (onAddToSession) {
    menuItems.push({
      section: "session",
      item: (
        <ContextMenuItem
          disabled={addToSessionDisabled}
          onSelect={() => {
            onAddToSession(commit);
          }}
        >
          {t("workspace.addCommitToSession")}
        </ContextMenuItem>
      ),
    });
  }

  if (menuItems.length === 0) {
    return children;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("workspace.git.commitActions")}>
        <ContextMenuSectionItems items={menuItems} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
