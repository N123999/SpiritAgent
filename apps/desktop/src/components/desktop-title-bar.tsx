import { cn } from "@/lib/utils";

const MENU_ENTRIES = [
  { label: "文件", section: "file" as const },
  { label: "编辑", section: "edit" as const },
  { label: "查看", section: "view" as const },
  { label: "窗口", section: "window" as const },
  { label: "帮助", section: "help" as const },
];

function popupMenuAtAnchor(
  el: HTMLElement,
  section: (typeof MENU_ENTRIES)[number]["section"],
): void {
  const r = el.getBoundingClientRect();
  void window.spiritDesktop?.popupApplicationMenu(section, r.left, r.bottom);
}

type DesktopTitleBarProps = {
  /** 与根布局云母透明策略一致 */
  useMicaBackdrop: boolean;
};

/**
 * Windows：自绘顶栏（LOGO + 菜单文案），窗口控制键仍由 `titleBarOverlay` 绘制。
 */
export function DesktopTitleBar({ useMicaBackdrop }: DesktopTitleBarProps) {
  return (
    <header
      className={cn(
        "electron-drag flex h-8 w-full shrink-0 items-center gap-1 border-b border-border/40 pl-2",
        useMicaBackdrop
          ? "bg-sidebar/30 backdrop-blur-md supports-backdrop-filter:bg-sidebar/20 dark:bg-transparent dark:backdrop-blur-none dark:supports-backdrop-filter:bg-transparent"
          : "bg-sidebar dark:bg-background",
      )}
    >
      <img
        src="/favicon.ico"
        alt=""
        width={20}
        height={20}
        draggable={false}
        className="electron-no-drag size-5 shrink-0 rounded-sm opacity-90"
      />
      <nav
        className="electron-no-drag flex items-center gap-0.5 text-[13px] leading-none"
        aria-label="应用菜单"
      >
        {MENU_ENTRIES.map(({ label, section }) => (
          <button
            key={section}
            type="button"
            className="rounded px-2 py-1.5 text-foreground/90 hover:bg-foreground/10 dark:hover:bg-white/10"
            onClick={(e) => popupMenuAtAnchor(e.currentTarget, section)}
          >
            {label}
          </button>
        ))}
      </nav>
      {/* 右侧留白由系统 titleBarOverlay 覆盖，中间带给用户拖拽 */}
      <div className="electron-drag min-h-0 min-w-0 flex-1" aria-hidden />
    </header>
  );
}
