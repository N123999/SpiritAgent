import { useTranslation } from "react-i18next";

import { PanelRightClose, PanelRightOpen, Plus } from "lucide-react";

import {
  NewSessionShortcutKbd,
  WorkspaceToolsShortcutKbd,
} from "@/components/layout/desktop-shortcut-kbds";
import { SessionSidebarToggleButton } from "@/components/layout/session-sidebar-toggle-button";
import { SessionChromeBreadcrumb } from "@/components/session-chrome-breadcrumb";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  DESKTOP_SHELL_LAYOUT_TRANSITION,
} from "@/lib/desktop-chrome";
import { desktopMicaTintClass } from "@/lib/desktop-mica-surface";
import { isDarwinElectronShell } from "@/lib/desktop-shell";
import { useDarwinWindowFullscreen } from "@/hooks/useDarwinWindowFullscreen";
import { cn } from "@/lib/utils";

export function DesktopLayoutChromeBar({
  useMicaBackdrop,
  showWorkspaceToggle,
  workspaceToolsOpen = false,
  onToggleWorkspaceTools,
  sessionTitle,
  subagentPromptText,
  onExitSubagentViewer,
  onNewSession,
  newSessionBusy = false,
}: {
  useMicaBackdrop: boolean;
  showWorkspaceToggle: boolean;
  workspaceToolsOpen?: boolean;
  onToggleWorkspaceTools?: () => void;
  sessionTitle?: string | null;
  subagentPromptText?: string | null;
  onExitSubagentViewer?: () => void;
  onNewSession?: () => void;
  newSessionBusy?: boolean;
}) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen } = useSessionSidebarChrome();
  const darwinElectron = isDarwinElectronShell();
  const darwinFullScreen = useDarwinWindowFullscreen(darwinElectron);
  const pinSidebarToggleOnDarwin = darwinElectron && !darwinFullScreen;
  const showTrailingActions = showWorkspaceToggle;
  const trimmedSessionTitle = sessionTitle?.trim() ?? "";
  return (
    <div
      role="toolbar"
      aria-label={t('app.sidebarAndTools')}
      data-spirit-surface="layout-chrome"
      data-session-sidebar-open={sessionSidebarOpen ? "true" : "false"}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 px-1.5",
        showTrailingActions ? "justify-between" : "justify-start",
        desktopMicaTintClass(useMicaBackdrop),
      )}
    >
      <div className="flex min-w-0 items-center">
        {pinSidebarToggleOnDarwin ? (
          <div data-darwin-pinned-sidebar-toggle>
            <SessionSidebarToggleButton />
          </div>
        ) : (
          <SessionSidebarToggleButton className="mr-1" />
        )}
        {pinSidebarToggleOnDarwin ? (
          <div
            className={cn(
              "shrink-0 overflow-hidden",
              DESKTOP_SHELL_LAYOUT_TRANSITION,
              sessionSidebarOpen ? "mr-0 w-0" : "mr-1 w-7",
            )}
            aria-hidden
          />
        ) : null}
        {onNewSession ? (
          <div
            className={cn(
              "shrink-0 overflow-hidden",
              DESKTOP_SHELL_LAYOUT_TRANSITION,
              sessionSidebarOpen
                ? "pointer-events-none mr-0 w-0 opacity-0"
                : "mr-1 w-7 opacity-100",
            )}
            aria-hidden={sessionSidebarOpen}
          >
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  onClick={onNewSession}
                  disabled={newSessionBusy}
                  tabIndex={sessionSidebarOpen ? -1 : undefined}
                  aria-label={t("sidebar.newSession")}
                >
                  <Plus className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {t("sidebar.newSession")}{" "}
                <NewSessionShortcutKbd />
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
        {trimmedSessionTitle ? (
          <SessionChromeBreadcrumb
            sessionTitle={trimmedSessionTitle}
            subagentPromptText={subagentPromptText}
            onExitSubagentViewer={onExitSubagentViewer}
          />
        ) : null}
      </div>
      {showTrailingActions ? (
        <div className="flex items-center gap-1">
          {showWorkspaceToggle ? (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={DESKTOP_CHROME_TOGGLE_ICON_BTN}
                  onClick={() => onToggleWorkspaceTools?.()}
                  aria-label={workspaceToolsOpen ? t('app.collapseTools') : t('app.expandTools')}
                  aria-expanded={workspaceToolsOpen}
                  {...(workspaceToolsOpen ? { "aria-controls": "workspace-tools-panel" } : {})}
                >
                  {workspaceToolsOpen ? (
                    <PanelRightClose className="size-3.5" aria-hidden />
                  ) : (
                    <PanelRightOpen className="size-3.5" aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {workspaceToolsOpen ? t("app.collapseTools") : t("app.expandTools")}{" "}
                <WorkspaceToolsShortcutKbd />
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
