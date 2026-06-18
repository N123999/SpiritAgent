import { useTranslation } from "react-i18next";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { SessionSidebarShortcutKbd } from "@/components/layout/desktop-shortcut-kbds";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { DESKTOP_CHROME_TOGGLE_ICON_BTN } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

export function SessionSidebarToggleButton({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { open: sessionSidebarOpen, toggle: onToggleSessionSidebar } = useSessionSidebarChrome();

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, className)}
          onClick={onToggleSessionSidebar}
          aria-label={sessionSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}
          aria-expanded={sessionSidebarOpen}
          {...(sessionSidebarOpen ? { "aria-controls": "session-sidebar-panel" } : {})}
        >
          {sessionSidebarOpen ? (
            <PanelLeftClose className="size-3.5" aria-hidden />
          ) : (
            <PanelLeftOpen className="size-3.5" aria-hidden />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {sessionSidebarOpen ? t("app.hideSidebar") : t("app.showSidebar")}{" "}
        <SessionSidebarShortcutKbd />
      </TooltipContent>
    </Tooltip>
  );
}
