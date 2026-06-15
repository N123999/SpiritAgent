import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { desktopShellPlatform } from "@/lib/desktop-shell";

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
  isElectron: boolean;
  onReveal?: (target: WorkspaceExplorerContextTarget) => void;
  onRename?: (target: WorkspaceExplorerContextTarget) => void;
  onDelete?: (target: WorkspaceExplorerContextTarget) => void;
  onAddToSession?: (target: WorkspaceExplorerContextTarget) => void;
  children: ReactNode;
};

export function WorkspaceFileContextMenu({
  target,
  isElectron,
  onReveal,
  onRename,
  onDelete,
  onAddToSession,
  children,
}: WorkspaceFileContextMenuProps) {
  const { t } = useTranslation();
  const revealLabel = useRevealInExplorerLabel();
  const trashLabel = useMoveToTrashLabel();
  const shellActionsEnabled = isElectron && Boolean(onReveal);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("workspace.fileActions")}>
        <ContextMenuItem
          disabled={!shellActionsEnabled}
          title={!isElectron ? t("workspace.shellElectronOnly") : undefined}
          onSelect={() => {
            onReveal?.(target);
          }}
        >
          {revealLabel}
        </ContextMenuItem>
        {onAddToSession ? (
          <ContextMenuItem
            disabled={target.kind !== "file"}
            onSelect={() => {
              onAddToSession(target);
            }}
          >
            {t("workspace.addFileToSession")}
          </ContextMenuItem>
        ) : null}
        {onRename ? (
          <ContextMenuItem
            onSelect={() => {
              onRename(target);
            }}
          >
            {t("workspace.rename")}
          </ContextMenuItem>
        ) : null}
        {onDelete ? (
          <ContextMenuItem
            variant="destructive"
            disabled={!shellActionsEnabled}
            title={!isElectron ? t("workspace.shellElectronOnly") : undefined}
            onSelect={() => {
              onDelete(target);
            }}
          >
            {trashLabel}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
