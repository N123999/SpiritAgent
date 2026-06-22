import { useLayoutEffect, useState, type RefObject } from "react";

const SESSION_SIDEBAR_SHELL_SELECTOR = '[data-spirit-surface="session-sidebar-shell"]';

/** 标题栏分割线左缘：与侧栏 shell 右缘对齐（含收起/展开 CSS 过渡帧）。 */
export function useSessionSidebarShellRightInsetPx(
  anchorRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): number {
  const [insetPx, setInsetPx] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) {
      setInsetPx(0);
      return;
    }

    const sync = () => {
      const anchor = anchorRef.current;
      const shell = document.querySelector(SESSION_SIDEBAR_SHELL_SELECTOR);
      if (!anchor || !shell) {
        setInsetPx(0);
        return;
      }
      const anchorRect = anchor.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      setInsetPx(Math.max(0, Math.round(shellRect.right - anchorRect.left)));
    };

    sync();
    const shell = document.querySelector(SESSION_SIDEBAR_SHELL_SELECTOR);
    if (!shell) {
      return;
    }

    const ro = new ResizeObserver(sync);
    ro.observe(shell);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [anchorRef, enabled]);

  return insetPx;
}
