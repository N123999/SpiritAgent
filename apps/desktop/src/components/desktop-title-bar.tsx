import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { spiritAgentBrandIconSrc } from "@/lib/brand-icon";
import { cn } from "@/lib/utils";

const MENU_ENTRIES = [
  { labelKey: "titleBar.file", section: "file" as const },
  { labelKey: "titleBar.edit", section: "edit" as const },
  { labelKey: "titleBar.view", section: "view" as const },
  { labelKey: "titleBar.window", section: "window" as const },
  { labelKey: "titleBar.help", section: "help" as const },
];

/** 与 [`App.tsx`](../App.tsx) 侧栏壳层宽度一致 */
const SESSION_SIDEBAR_WIDTH_CLASS = "w-[min(16rem,40vw)]";

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
  /** 侧栏是否展开（影响顶栏左侧菜单区宽度） */
  sessionSidebarOpen: boolean;
};

function titleBarSurfaceClass(
  useMicaBackdrop: boolean,
  withBorder: boolean,
  zone: "sidebar" | "main",
) {
  return cn(
    withBorder && (useMicaBackdrop ? "border-black/5 dark:border-white/10" : "border-border/40"),
    useMicaBackdrop
      ? "bg-transparent"
      : zone === "sidebar"
        ? "bg-sidebar dark:bg-background"
        : "bg-background",
  );
}

/** 顶栏菜单区图标显示边长（PNG 画布较大，需小于旧 favicon 的 20px 观感） */
const TITLE_BAR_ICON_PX = 14;

function TitleBarAppIcon() {
  const { resolvedDark } = useTheme();
  const iconSrc = spiritAgentBrandIconSrc(resolvedDark);
  return (
    <span
      className="electron-no-drag ml-1 inline-flex shrink-0 items-center justify-center"
      style={{ width: TITLE_BAR_ICON_PX, height: TITLE_BAR_ICON_PX }}
    >
      <img
        key={iconSrc}
        src={iconSrc}
        alt=""
        width={TITLE_BAR_ICON_PX}
        height={TITLE_BAR_ICON_PX}
        draggable={false}
        className="max-h-full max-w-full object-contain select-none"
      />
    </span>
  );
}

function TitleBarMenuCluster() {
  const { t } = useTranslation();
  return (
    <>
      <TitleBarAppIcon />
      <nav
        className="electron-no-drag flex items-center gap-0.5 text-[13px] leading-none"
        aria-label={t('titleBar.appMenu')}
      >
        {MENU_ENTRIES.map(({ labelKey, section }) => (
          <button
            key={section}
            type="button"
            className="rounded px-2 py-1.5 text-foreground/90 hover:bg-foreground/10 dark:hover:bg-white/10"
            onClick={(e) => popupMenuAtAnchor(e.currentTarget, section)}
          >
            {t(labelKey)}
          </button>
        ))}
      </nav>
    </>
  );
}

/**
 * Windows：自绘顶栏（LOGO + 菜单文案），窗口控制键仍由 `titleBarOverlay` 绘制。
 */
export function DesktopTitleBar({ useMicaBackdrop, sessionSidebarOpen }: DesktopTitleBarProps) {
  return (
    <header
      className={cn(
        "electron-drag flex h-8 w-full shrink-0 overflow-hidden border-b",
        titleBarSurfaceClass(useMicaBackdrop, true, "sidebar"),
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 shrink-0 items-center gap-1 pl-2",
          sessionSidebarOpen ? SESSION_SIDEBAR_WIDTH_CLASS : "min-w-0 flex-1",
          titleBarSurfaceClass(useMicaBackdrop, false, "sidebar"),
        )}
      >
        <TitleBarMenuCluster />
      </div>
      <div
        className={cn(
          "electron-drag h-full min-w-0 flex-1",
          titleBarSurfaceClass(useMicaBackdrop, false, sessionSidebarOpen ? "main" : "sidebar"),
        )}
        aria-hidden
      />
    </header>
  );
}
