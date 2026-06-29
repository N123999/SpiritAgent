import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionItems,
  type ContextMenuSectionItem,
} from "@/components/ui/context-menu";
import type { GitCommitRecord } from "@/types";

export type WorkspaceGitCommitContextMenuContentProps = {
  commit: GitCommitRecord | null;
  commitRef: RefObject<GitCommitRecord | null>;
  onAddToSession?: (commit: GitCommitRecord) => void;
  addToSessionDisabled?: boolean;
};

/** 面板级单一 ContextMenu 的 Content（对齐 session-sidebar 列表 capture 模式）。 */
export function WorkspaceGitCommitContextMenuContent({
  commit,
  commitRef,
  onAddToSession,
  addToSessionDisabled = false,
}: WorkspaceGitCommitContextMenuContentProps) {
  const { t } = useTranslation();

  if (!onAddToSession) {
    return null;
  }

  const menuItems: ContextMenuSectionItem[] = [
    {
      section: "session",
      item: (
        <ContextMenuItem
          disabled={addToSessionDisabled}
          onSelect={() => {
            const resolved = commitRef.current ?? commit;
            if (resolved) {
              onAddToSession(resolved);
            }
          }}
        >
          {t("workspace.addCommitToSession")}
        </ContextMenuItem>
      ),
    },
  ];

  return (
    <ContextMenuContent aria-label={t("workspace.git.commitActions")}>
      <ContextMenuSectionItems items={menuItems} />
    </ContextMenuContent>
  );
}
