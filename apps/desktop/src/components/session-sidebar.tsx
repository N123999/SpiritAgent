import { Plus, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { DesktopSnapshot, SessionListItem } from "@/types";

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

type SessionSidebarProps = {
  className?: string;
  /** 窄轨：只换样式/折叠列表，不切换整棵子树，避免与外层 width 动画错拍 */
  narrow: boolean;
  sessions: SessionListItem[];
  activeFilePath: string | null;
  onSelectSession: (path: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  hostStatus: string;
  mcpState: string | null;
  micaStyle?: boolean;
  busy?: boolean;
  disabled?: boolean;
};

export function SessionSidebar({
  className,
  narrow,
  sessions,
  activeFilePath,
  onSelectSession,
  onNewSession,
  onOpenSettings,
  hostStatus,
  mcpState,
  micaStyle,
  busy,
  disabled,
}: SessionSidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden text-sidebar-foreground",
        micaStyle
          ? "border-r border-black/5 bg-sidebar/30 backdrop-blur-2xl supports-backdrop-filter:bg-sidebar/25 dark:border-white/10"
          : "border-r border-border/30 bg-sidebar dark:border-white/[0.12]",
        className,
      )}
      data-narrow={narrow || undefined}
      id="session-sidebar-panel"
      aria-label="会话与设置侧栏"
    >
      <div
        className={cn(
          "flex flex-col gap-1.5 px-1.5 pt-2.5",
          narrow && "shrink-0 items-center",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size={narrow ? "icon" : "sm"}
          className={cn(
            "text-xs text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
            narrow
              ? "size-8 shrink-0"
              : "h-8 w-full justify-start gap-2",
          )}
          disabled={disabled || busy}
          onClick={onNewSession}
        >
          <Plus className="size-3.5" aria-hidden />
          <span className={cn(narrow && "sr-only")}>新会话</span>
        </Button>
      </div>

      <div
        className={cn("min-h-0 w-full min-w-0 flex-1 overflow-hidden", narrow && "hidden min-h-0 flex-none")}
        aria-hidden={narrow}
      >
        <ScrollArea className="h-full min-h-0" type="hover" scrollHideDelay={450}>
          <div className="p-1.5">
            <p className="px-1 pb-1.5 text-[0.65rem] text-sidebar-faint-foreground">已保存</p>
            {sessions.length === 0 ? (
              <p className="px-2 py-2 text-center text-xs text-sidebar-faint-foreground">暂无</p>
            ) : (
              <nav className="flex flex-col gap-0.5" aria-label="已保存会话">
                {sessions.map((session) => {
                  const selected =
                    activeFilePath !== null && samePath(session.path, activeFilePath);
                  return (
                    <button
                      key={session.path}
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => onSelectSession(session.path)}
                      className={cn(
                        "group flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm",
                        "text-sidebar-list-foreground outline-none transition-[color,background,box-shadow] duration-150",
                        "hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.07]",
                        "hover:text-sidebar-foreground",
                        "focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                        selected && "bg-foreground/[0.08] text-sidebar-foreground dark:bg-foreground/12",
                      )}
                    >
                      <span
                        className="w-full truncate text-xs font-medium"
                        title={session.displayName}
                      >
                        {session.displayName}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </ScrollArea>
      </div>

      <div
        className={cn(
          "shrink-0 space-y-1 border-t border-sidebar-border/30 p-2",
          narrow && "mt-auto flex flex-col items-center gap-1.5 border-t py-2",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size={narrow ? "icon" : "sm"}
          className={cn(
            "text-sidebar-foreground/90 hover:bg-foreground/[0.05] dark:hover:bg-foreground/10",
            narrow ? "size-8" : "h-8 w-full justify-start gap-2",
          )}
          onClick={onOpenSettings}
        >
          <Settings2 className="size-4" aria-hidden />
          <span className={cn(narrow && "sr-only")}>设置</span>
        </Button>
        {narrow ? (
          <>
            <p className="sr-only" role="status">
              {hostStatus}
              {mcpState ? ` · ${mcpState}` : null}
            </p>
            <div
              className="size-1.5 rounded-full bg-sidebar-faint-foreground/50"
              title={mcpState ? `${hostStatus} · ${mcpState}` : hostStatus}
              aria-hidden
            />
          </>
        ) : (
          <p className="line-clamp-2 px-1.5 text-[0.65rem] leading-relaxed text-sidebar-faint-foreground">
            {hostStatus}
            {mcpState ? ` · ${mcpState}` : null}
          </p>
        )}
      </div>
    </aside>
  );
}

export function mcpBadgeText(snapshot: DesktopSnapshot | null): string | null {
  if (!snapshot) {
    return null;
  }
  return `MCP ${snapshot.mcpStatus.state}`;
}
