import { useCallback, useRef, useState } from "react";

import { FileText, GitBranch, Terminal } from "lucide-react";

import { cn } from "@/lib/utils";

export type WorkspaceToolsTab = "files" | "shell" | "git";

const TAB_ITEMS: Array<{ id: WorkspaceToolsTab; label: string; icon: typeof FileText }> = [
  { id: "files", label: "文件", icon: FileText },
  { id: "shell", label: "Shell", icon: Terminal },
  { id: "git", label: "Git", icon: GitBranch },
];

export type WorkspaceToolsDockProps = {
  /** 右侧面板宽度（像素） */
  widthPx: number;
  minWidthPx?: number;
  maxWidthPx?: number;
  onWidthPxChange(next: number): void;
  open: boolean;
  className?: string;
};

const DEFAULT_MIN = 240;
const DEFAULT_MAX = 640;

export function WorkspaceToolsDock({
  widthPx,
  minWidthPx = DEFAULT_MIN,
  maxWidthPx = DEFAULT_MAX,
  onWidthPxChange,
  open,
  className,
}: WorkspaceToolsDockProps) {
  const [tab, setTab] = useState<WorkspaceToolsTab>("files");
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const clampWidth = useCallback(
    (value: number) => Math.min(maxWidthPx, Math.max(minWidthPx, value)),
    [minWidthPx, maxWidthPx],
  );

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startWidth: widthPx };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [widthPx],
  );

  const onResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      // 手柄在面板左缘：向左拖增大宽度
      const delta = drag.startX - event.clientX;
      onWidthPxChange(clampWidth(drag.startWidth + delta));
    },
    [clampWidth, onWidthPxChange],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 已释放或无 capture
    }
  }, []);

  if (!open) {
    return null;
  }

  return (
    <div className={cn("flex h-full min-h-0 shrink-0 flex-row self-stretch", className)}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整工具区宽度"
        className={cn(
          "group relative z-10 w-1 shrink-0 cursor-col-resize touch-none select-none",
          "before:absolute before:inset-y-0 before:-left-1 before:w-3 before:content-['']",
        )}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/40 transition-colors group-hover:bg-border/55"
          aria-hidden
        />
      </div>

      <aside
        id="workspace-tools-panel"
        className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-background text-foreground"
        style={{ width: widthPx }}
        aria-label="工作区工具"
      >
        <div
          role="tablist"
          aria-label="工具分页"
          className="flex shrink-0 gap-0 border-b border-border/40 px-1 pt-1.5 pb-0"
        >
          {TAB_ITEMS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t-md border border-transparent px-2 py-2 text-xs font-medium transition-colors",
                  selected
                    ? "border-border/40 border-b-background bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground dark:hover:bg-foreground/10",
                )}
                onClick={() => setTab(item.id)}
              >
                <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-hidden p-3 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {tab === "files" ? (
            <p>文件区占位</p>
          ) : tab === "shell" ? (
            <p>Shell 区占位</p>
          ) : (
            <p>Git 区占位</p>
          )}
        </div>
      </aside>
    </div>
  );
}
