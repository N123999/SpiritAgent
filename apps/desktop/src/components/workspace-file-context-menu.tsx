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

export type WorkspaceFileContextMenuProps = {
  target: WorkspaceExplorerContextTarget;
  workspaceRoot: string;
  isElectron: boolean;
  onReveal?: (target: WorkspaceExplorerContextTarget) => void;
  onRename?: (target: WorkspaceExplorerContextTarget) => void;
  onDelete?: (target: WorkspaceExplorerContextTarget) => void;
  onAddToSession?: (target: WorkspaceExplorerContextTarget) => void;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
};

export function WorkspaceFileContextMenu({
  target,
  workspaceRoot,
  isElectron,
  onReveal,
  onRename,
  onDelete,
  onAddToSession,
  onCloseAutoFocus,
  children,
}: WorkspaceFileContextMenuProps) {
  const { t } = useTranslation();
  const revealLabel = useRevealInExplorerLabel();
  const shellActionsEnabled = isElectron && Boolean(onReveal);
  const deleteEnabled = isElectron && Boolean(onDelete);
  const absolutePath = joinWorkspaceAbsolutePath(workspaceRoot, target.relativePath);
  const relativePathForCopy = formatWorkspaceRelativePathForCopy(target.relativePath);

  const menuItems: ContextMenuSectionItem[] = [];

  if (onReveal) {
    menuItems.push({
      section: "explorer",
      item: (
        <ContextMenuItem
          disabled={!shellActionsEnabled}
          title={!isElectron ? t("workspace.shellElectronOnly") : undefined}
          onSelect={() => {
            onReveal(target);
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
          disabled={target.kind !== "file"}
          onSelect={() => {
            onAddToSession(target);
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
            void navigator.clipboard.writeText(absolutePath);
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
            void navigator.clipboard.writeText(relativePathForCopy);
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
            onRename(target);
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
            onDelete(target);
          }}
        >
          {t("workspace.delete")}
        </ContextMenuItem>
      ),
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={t("workspace.fileActions")}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ContextMenuSectionItems items={menuItems} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
