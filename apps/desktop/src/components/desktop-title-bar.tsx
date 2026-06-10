import { useTranslation } from "react-i18next";

import { useSessionSidebarChrome } from "@/contexts/session-sidebar-chrome-context";
import { useTheme } from "@/hooks/useTheme";
import { spiritAgentTitleBarIconSrc } from "@/lib/brand-icon";
import { sessionSidebarShellWidth } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
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

function TitleBarMenuCluster({ useMicaBackdrop }: { useMicaBackdrop: boolean }) {
  const { t } = useTranslation();
  const isDevChrome = import.meta.env.DEV;
  return (
    <div className="electron-no-drag flex shrink-0 items-center gap-1">
      <TitleBarAppIcon useMicaBackdrop={useMicaBackdrop} />
      <Menubar
        className="h-auto border-none bg-transparent p-0 shadow-none"
        aria-label={t('titleBar.appMenu')}
      >
        <MenubarMenu>
          <MenubarTrigger className="px-2 py-1 text-[13px] text-foreground/90">
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
          <MenubarTrigger className="px-2 py-1 text-[13px] text-foreground/90">
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
          <MenubarTrigger className="px-2 py-1 text-[13px] text-foreground/90">
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
            <MenubarItem onSelect={() => execWindowAction('toggleFullscreen')}>
              {t('titleBar.toggleFullscreen')}
              <MenubarShortcut>F11</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="px-2 py-1 text-[13px] text-foreground/90">
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
          <MenubarTrigger className="px-2 py-1 text-[13px] text-foreground/90">
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
export function DesktopTitleBar({ useMicaBackdrop }: DesktopTitleBarProps) {
  const { open: sessionSidebarOpen, widthPx: sessionSidebarWidthPx } = useSessionSidebarChrome();
  /** Mica 开启且侧边栏展开：横向分割线只渲染在侧边栏竖线右侧 */
  const partialBorder = useMicaBackdrop && sessionSidebarOpen;
  return (
    <header
      className={cn(
        "electron-drag flex h-8 w-full shrink-0 overflow-hidden border-b",
        partialBorder && "border-transparent",
        titleBarSurfaceClass(useMicaBackdrop, !partialBorder),
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
      <div
        className={cn(
          "electron-drag relative h-full min-w-0 flex-1",
        )}
        aria-hidden
      >
        {partialBorder ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-black/5 dark:bg-white/10"
            aria-hidden
          />
        ) : null}
      </div>
    </header>
  );
}
