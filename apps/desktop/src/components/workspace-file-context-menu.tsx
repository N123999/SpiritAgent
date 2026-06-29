import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSectionItems,
  type ContextMenuSectionItem,
} from "@/components/ui/context-menu";
import { desktopShellPlatform } from "@/lib/desktop-shell";

import {
  formatWorkspaceRelativePathForCopy,
  joinWorkspaceAbsolutePath,
} from "@/lib/workspace-entry-path-sync";

export type WorkspaceExplorerContextTarget = {
  relativePath: string;
  kind: "file" | "dir";
  name: string;
};

function platformKey(base: string): string {
  const platform = desktopShellPlatform();
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return `${base}.${platform}`;
  }
  return `${base}.linux`;
}

export function useRevealInExplorerLabel(): string {
  const { t } = useTranslation();
  return t(platformKey("workspace.revealInExplorer"));
}

export function useMoveToTrashLabel(): string {
  const { t } = useTranslation();
  return t(platformKey("workspace.moveToTrash"));
}

export type WorkspaceFileContextMenuContentProps = {
  target: WorkspaceExplorerContextTarget | null;
  targetRef: RefObject<WorkspaceExplorerContextTarget | null>;
  workspaceRoot: string;
  isElectron: boolean;
  onReveal?: (target: WorkspaceExplorerContextTarget) => void;
  onRename?: (target: WorkspaceExplorerContextTarget) => void;
  onDelete?: (target: WorkspaceExplorerContextTarget) => void;
  onAddToSession?: (target: WorkspaceExplorerContextTarget) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** 面板级单一 ContextMenu 的 Content（对齐 session-sidebar WorkspaceListNav 模式）。 */
export function WorkspaceFileContextMenuContent({
  target,
  targetRef,
  workspaceRoot,
  isElectron,
  onReveal,
  onRename,
  onDelete,
  onAddToSession,
  onCloseAutoFocus,
}: WorkspaceFileContextMenuContentProps) {
  const { t } = useTranslation();
  const revealLabel = useRevealInExplorerLabel();
  const resolved = targetRef.current ?? target;
  const shellActionsEnabled = isElectron && Boolean(onReveal) && Boolean(resolved);
  const deleteEnabled = isElectron && Boolean(onDelete) && Boolean(resolved);

  const menuItems: ContextMenuSectionItem[] = [];

  if (onReveal) {
    menuItems.push({
      section: "explorer",
      item: (
        <ContextMenuItem
          disabled={!shellActionsEnabled}
          title={!isElectron ? t("workspace.shellElectronOnly") : undefined}
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (entry) {
              onReveal(entry);
            }
          }}
        >
          {revealLabel}
        </ContextMenuItem>
      ),
    });
  }

  if (onAddToSession) {
    menuItems.push({
      section: "session",
      item: (
        <ContextMenuItem
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (entry) {
              onAddToSession(entry);
            }
          }}
        >
          {t("workspace.addFileToSession")}
        </ContextMenuItem>
      ),
    });
  }

  menuItems.push(
    {
      section: "copy-path",
      item: (
        <ContextMenuItem
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (!entry) {
              return;
            }
            void navigator.clipboard.writeText(
              joinWorkspaceAbsolutePath(workspaceRoot, entry.relativePath),
            );
          }}
        >
          {t("workspace.copyPath")}
        </ContextMenuItem>
      ),
    },
    {
      section: "copy-path",
      item: (
        <ContextMenuItem
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (!entry) {
              return;
            }
            void navigator.clipboard.writeText(
              formatWorkspaceRelativePathForCopy(entry.relativePath),
            );
          }}
        >
          {t("workspace.copyRelativePath")}
        </ContextMenuItem>
      ),
    },
  );

  if (onRename) {
    menuItems.push({
      section: "file-actions",
      item: (
        <ContextMenuItem
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (entry) {
              onRename(entry);
            }
          }}
        >
          {t("workspace.rename")}
        </ContextMenuItem>
      ),
    });
  }

  if (onDelete) {
    menuItems.push({
      section: "file-actions",
      item: (
        <ContextMenuItem
          variant="destructive"
          disabled={!deleteEnabled}
          title={!isElectron ? t("workspace.shellElectronOnly") : undefined}
          onSelect={() => {
            const entry = targetRef.current ?? target;
            if (entry) {
              onDelete(entry);
            }
          }}
        >
          {t("workspace.delete")}
        </ContextMenuItem>
      ),
    });
  }

  return (
    <ContextMenuContent
      aria-label={t("workspace.fileActions")}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <ContextMenuSectionItems items={menuItems} />
    </ContextMenuContent>
  );
}
