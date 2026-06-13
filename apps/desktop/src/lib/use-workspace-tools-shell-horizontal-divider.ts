import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  getWorkspaceToolsShellDividerLeftPx,
  getWorkspaceToolsShellSplit,
} from "@/lib/workspace-tools-panel-edge";

type ShellHorizontalDividerEdge = "top" | "bottom";

type UseWorkspaceToolsShellHorizontalDividerOptions = {
  enabled?: boolean;
  edge?: ShellHorizontalDividerEdge;
  dividerAttr: string;
  /** Re-sync when these elements resize (e.g. sibling pane height changes). */
  watchRefs?: RefObject<HTMLElement | null>[];
};

export function useWorkspaceToolsShellHorizontalDivider(
  anchorRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    edge = "bottom",
    dividerAttr,
    watchRefs = [],
  }: UseWorkspaceToolsShellHorizontalDividerOptions,
  layoutDeps: readonly unknown[] = [],
) {
  const syncRef = useRef<(() => void) | null>(null);
  const watchRefsRef = useRef(watchRefs);
  watchRefsRef.current = watchRefs;

  useLayoutEffect(() => {
    if (!enabled) {
      syncRef.current = null;
      return;
    }

    const shellSplit = getWorkspaceToolsShellSplit();
    if (!shellSplit) {
      syncRef.current = null;
      return;
    }

    let shellDivider = shellSplit.querySelector<HTMLElement>(`[${dividerAttr}]`);
    if (!shellDivider) {
      shellDivider = document.createElement("div");
      shellDivider.setAttribute(dividerAttr, "");
      shellDivider.className = "pointer-events-none absolute right-0 z-20 h-px bg-border/40";
      shellSplit.appendChild(shellDivider);
    }

    const sync = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        shellDivider!.style.display = "none";
        return;
      }

      const shellRect = shellSplit.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const leftPx = getWorkspaceToolsShellDividerLeftPx(shellSplit);
      const topPx =
        edge === "bottom"
          ? anchorRect.bottom - shellRect.top - 1
          : anchorRect.top - shellRect.top;

      shellDivider!.style.display = "block";
      shellDivider!.style.left = `${leftPx}px`;
      shellDivider!.style.right = "0px";
      shellDivider!.style.top = `${topPx}px`;
    };

    syncRef.current = sync;
    sync();

    const resizeObserver = new ResizeObserver(sync);
    const anchor = anchorRef.current;
    if (anchor) {
      resizeObserver.observe(anchor);
    }
    resizeObserver.observe(shellSplit);
    for (const watchRef of watchRefsRef.current) {
      const node = watchRef.current;
      if (node) {
        resizeObserver.observe(node);
      }
    }
    window.addEventListener("resize", sync);

    return () => {
      syncRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", sync);
      shellDivider!.style.display = "none";
    };
  }, [anchorRef, dividerAttr, edge, enabled]);

  useLayoutEffect(() => {
    syncRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls layout invalidation
  }, layoutDeps);
}
