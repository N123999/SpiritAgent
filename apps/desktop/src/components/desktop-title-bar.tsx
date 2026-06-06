import { useTranslation } from "react-i18next";

import { useTheme } from "@/hooks/useTheme";
import { spiritAgentTitleBarIconSrc } from "@/lib/brand-icon";
import { sessionSidebarShellWidth } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

const MENU_ENTRIES = [
  { labelKey: "titleBar.file", section: "file" as const },
  { labelKey: "titleBar.edit", section: "edit" as const },
  { labelKey: "titleBar.view", section: "view" as const },
  { labelKey: "titleBar.window", section: "window" as const },
  { labelKey: "titleBar.help", section: "help" as const },
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
  /** 侧栏是否展开（影响顶栏左侧菜单区宽度） */
  sessionSidebarOpen: boolean;
  /** 与主布局 session-sidebar-shell 一致（像素宽，不含拖动手柄） */
  sessionSidebarWidthPx: number;
};

function titleBarSurfaceClass(useMicaBackdrop: boolean, withBorder: boolean) {
  return cn(
    withBorder && (useMicaBackdrop ? "border-black/5 dark:border-white/10" : "border-border/40"),
    useMicaBackdrop ? "bg-transparent" : "bg-sidebar",
  );
}

/** 透明底顶栏标（`spirit-agent-icon*.png` 画布大，14px 观感接近旧 20px favicon） */
const TITLE_BAR_ICON_PX = 14;

/** 云母顶栏黑底标（`build/icon.png` 内图案更小，恢复迁移透明标前的 20px） */
const TITLE_BAR_ICON_MICA_PX = 20;

function TitleBarAppIcon({ useMicaBackdrop }: { useMicaBackdrop: boolean }) {
  const { resolvedDark } = useTheme();
  const iconSrc = spiritAgentTitleBarIconSrc(resolvedDark, useMicaBackdrop);
  const iconPx = useMicaBackdrop ? TITLE_BAR_ICON_MICA_PX : TITLE_BAR_ICON_PX;
  return (
    <span
      className="electron-no-drag ml-1 inline-flex shrink-0 items-center justify-center"
      style={{ width: iconPx, height: iconPx }}
    >
      <img
        key={iconSrc}
        src={iconSrc}
        alt=""
        width={iconPx}
        height={iconPx}
        draggable={false}
        className={cn(
          "max-h-full max-w-full object-contain select-none",
          useMicaBackdrop && "rounded-sm",
        )}
      />
    </span>
  );
}

function TitleBarMenuCluster({ useMicaBackdrop }: { useMicaBackdrop: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <TitleBarAppIcon useMicaBackdrop={useMicaBackdrop} />
      <nav
        className="electron-no-drag flex shrink-0 items-center gap-0.5 text-[13px] leading-none"
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
export function DesktopTitleBar({
  useMicaBackdrop,
  sessionSidebarOpen,
  sessionSidebarWidthPx,
}: DesktopTitleBarProps) {
  return (
    <header
      className={cn(
        "electron-drag flex h-8 w-full shrink-0 overflow-hidden border-b",
        titleBarSurfaceClass(useMicaBackdrop, true),
      )}
    >
      <div
        className={cn(
          "flex h-full min-h-0 shrink-0 items-center gap-1 pl-2",
          !sessionSidebarOpen && "min-w-0 flex-1",
        )}
        style={
          sessionSidebarOpen
            ? { width: sessionSidebarShellWidth(true, sessionSidebarWidthPx) }
            : undefined
        }
      >
        <TitleBarMenuCluster useMicaBackdrop={useMicaBackdrop} />
      </div>
      <div className="electron-drag h-full min-w-0 flex-1" aria-hidden />
    </header>
  );
}
