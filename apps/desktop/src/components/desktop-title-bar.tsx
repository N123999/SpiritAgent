import { useTranslation } from "react-i18next";
import { useRef } from "react";
import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { useTheme } from "@/hooks/useTheme";
import { useSessionSidebarShellRightInsetPx } from "@/hooks/useSessionSidebarShellRightInsetPx";
import { spiritAgentTitleBarIconSrc } from "@/lib/brand-icon";
import { sessionSidebarShellWidth } from "@/lib/desktop-chrome";
import { desktopMicaTitleBarTintClass } from "@/lib/desktop-mica-surface";
import { cn } from "@/lib/utils";
import { isViteDev } from "@/lib/vite-dev";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";

type DesktopTitleBarProps = {
  /** 与根布局云母透明策略一致 */
  useMicaBackdrop: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

type TitleBarZoomMenuProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
};

function titleBarSurfaceClass(useMicaBackdrop: boolean, withBorder: boolean) {
  return cn(
    withBorder && (useMicaBackdrop ? "border-black/5 dark:border-white/10" : "border-border/40"),
    desktopMicaTitleBarTintClass(useMicaBackdrop),
  );
}

/** 透明底顶栏标（`spirit-agent-icon*.png` 画布大，14px 观感接近旧 20px favicon） */
const TITLE_BAR_ICON_PX = 14;

/** 云母顶栏黑底标（`build/icon.png` 内图案更小，恢复迁移透明标前的 20px） */
const TITLE_BAR_ICON_MICA_PX = 20;

/** 与侧栏交互项默认字色一致（`text-sidebar-action-foreground`） */
const TITLE_BAR_MENUBAR_TRIGGER_CLASS =
  "px-2 py-1 text-[13px] text-sidebar-action-foreground";

function execWindowAction(action: string): void {
  void window.spiritDesktop?.executeWindowAction(action);
}

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

function TitleBarMenuCluster({
  useMicaBackdrop,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  useMicaBackdrop: boolean;
} & TitleBarZoomMenuProps) {
  const { t } = useTranslation();
  const isDevChrome = isViteDev;
  return (
    <div className="electron-no-drag flex shrink-0 items-center gap-1">
      <TitleBarAppIcon useMicaBackdrop={useMicaBackdrop} />
      <Menubar
        className="h-auto border-none bg-transparent p-0 shadow-none"
        aria-label={t('titleBar.appMenu')}
      >
        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t('titleBar.file')}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => void window.spiritDesktop?.resetSession()}>
              {t('titleBar.newSession')}
              <MenubarShortcut>Ctrl+N</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => execWindowAction('quit')}>
              {t('titleBar.quit')}
              <MenubarShortcut>Ctrl+Q</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t('titleBar.edit')}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => document.execCommand('undo')}>
              {t('titleBar.undo')}
              <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => document.execCommand('redo')}>
              {t('titleBar.redo')}
              <MenubarShortcut>Ctrl+Y</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => document.execCommand('cut')}>
              {t('titleBar.cut')}
              <MenubarShortcut>Ctrl+X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => document.execCommand('copy')}>
              {t('titleBar.copy')}
              <MenubarShortcut>Ctrl+C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => document.execCommand('paste')}>
              {t('titleBar.paste')}
              <MenubarShortcut>Ctrl+V</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => document.execCommand('selectAll')}>
              {t('titleBar.selectAll')}
              <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t('titleBar.view')}
          </MenubarTrigger>
          <MenubarContent>
            {isDevChrome && (
              <>
                <MenubarItem onSelect={() => execWindowAction('reload')}>
                  {t('titleBar.reload')}
                  <MenubarShortcut>Ctrl+R</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => execWindowAction('forceReload')}>
                  {t('titleBar.forceReload')}
                  <MenubarShortcut>Ctrl+Shift+R</MenubarShortcut>
                </MenubarItem>
                <MenubarItem onSelect={() => execWindowAction('toggleDevTools')}>
                  {t('titleBar.devTools')}
                  <MenubarShortcut>F12</MenubarShortcut>
                </MenubarItem>
                <MenubarSeparator />
              </>
            )}
            <MenubarItem onSelect={onZoomIn}>
              {t('titleBar.zoomIn')}
              <MenubarShortcut>Ctrl+=</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onZoomOut}>
              {t('titleBar.zoomOut')}
              <MenubarShortcut>Ctrl+-</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={onZoomReset}>
              {t('titleBar.zoomReset')}
              <MenubarShortcut>Ctrl+0</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => execWindowAction('toggleFullscreen')}>
              {t('titleBar.toggleFullscreen')}
              <MenubarShortcut>F11</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t('titleBar.window')}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => execWindowAction('minimize')}>
              {t('titleBar.minimize')}
              <MenubarShortcut>Win+↓</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => execWindowAction('maximize')}>
              {t('titleBar.maximize')}
              <MenubarShortcut>Win+↑</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => execWindowAction('close')}>
              {t('titleBar.close')}
              <MenubarShortcut>Alt+F4</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={TITLE_BAR_MENUBAR_TRIGGER_CLASS}>
            {t('titleBar.help')}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => execWindowAction('showAbout')}>
              {t('titleBar.about')}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </div>
  );
}

/**
 * Windows：自绘顶栏（LOGO + 菜单文案），窗口控制键仍由 `titleBarOverlay` 绘制。
 */
export function DesktopTitleBar({
  useMicaBackdrop,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: DesktopTitleBarProps) {
  const headerRef = useRef<HTMLElement>(null);
  const { open: sessionSidebarOpen, widthPx: sessionSidebarWidthPx } = useSessionSidebarChrome();
  /** Blur 下横向分割线锚定侧栏 shell 右缘；收起/展开时随 shell 实际宽度同步移动。 */
  const partialBorder = useMicaBackdrop;
  const sidebarShellRightInsetPx = useSessionSidebarShellRightInsetPx(headerRef, partialBorder);

  return (
    <header
      ref={headerRef}
      data-spirit-surface="desktop-title-bar"
      className={cn(
        "relative electron-drag flex h-8 w-full shrink-0 overflow-hidden",
        partialBorder ? "border-b-0" : "border-b",
        titleBarSurfaceClass(useMicaBackdrop, !partialBorder),
      )}
    >
      {partialBorder ? (
        <div
          className="pointer-events-none absolute bottom-0 right-0 h-px bg-black/5 dark:bg-white/10"
          style={{ left: sidebarShellRightInsetPx }}
          aria-hidden
        />
      ) : null}
      <div
        className="flex h-full min-h-0 w-fit shrink-0 items-center gap-1 pl-2"
        style={
          sessionSidebarOpen
            ? { minWidth: sessionSidebarShellWidth(true, sessionSidebarWidthPx) }
            : undefined
        }
      >
        <TitleBarMenuCluster
          useMicaBackdrop={useMicaBackdrop}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onZoomReset={onZoomReset}
        />
      </div>
      <div
        className="electron-drag relative h-full min-w-0 flex-1"
        aria-hidden
      />
    </header>
  );
}
