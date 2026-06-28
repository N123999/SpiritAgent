import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  getWorkspaceToolsShellDividerLeftPx,
  getWorkspaceToolsShellDividerLeftPxFromAnchor,
  getWorkspaceToolsShellSplit,
  shellLocalLengthFromViewportDelta,
} from "@/lib/workspace-tools-panel-edge";

type ShellHorizontalDividerEdge = "top" | "bottom";

type UseWorkspaceToolsShellHorizontalDividerOptions = {
  enabled?: boolean;
  edge?: ShellHorizontalDividerEdge;
  dividerAttr: string;
  /** Distinguish multiple dividers that share the same `dividerAttr`. */
  dividerKey?: string;
  /** When set, horizontal divider starts at this anchor edge instead of the shell resize line. */
  dividerAnchorRef?: RefObject<HTMLElement | null>;
  dividerAnchorEdge?: "left" | "right";
  /** Re-sync when these elements resize (e.g. sibling pane height changes). */
  watchRefs?: RefObject<HTMLElement | null>[];
};

function shellHorizontalDividerSelector(dividerAttr: string, dividerKey?: string): string {
  if (dividerKey === undefined) {
    return `[${dividerAttr}]`;
  }
  return `[${dividerAttr}="${CSS.escape(dividerKey)}"]`;
}

function shellHorizontalDividerOwnerKey(dividerAttr: string, dividerKey?: string): string {
  return dividerKey === undefined ? dividerAttr : `${dividerAttr}\0${dividerKey}`;
}

const shellHorizontalDividerRefCounts = new Map<string, number>();

export function useWorkspaceToolsShellHorizontalDivider(
  anchorRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    edge = "bottom",
    dividerAttr,
    dividerKey,
    dividerAnchorRef,
    dividerAnchorEdge = "left",
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

    let shellDivider = shellSplit.querySelector<HTMLElement>(
      shellHorizontalDividerSelector(dividerAttr, dividerKey),
    );
    if (!shellDivider) {
      shellDivider = document.createElement("div");
      shellDivider.setAttribute(dividerAttr, dividerKey ?? "");
      shellDivider.className = "pointer-events-none absolute right-0 z-20 h-px bg-border/40";
      shellSplit.appendChild(shellDivider);
    }

    const ownerKey = shellHorizontalDividerOwnerKey(dividerAttr, dividerKey);
    shellHorizontalDividerRefCounts.set(
      ownerKey,
      (shellHorizontalDividerRefCounts.get(ownerKey) ?? 0) + 1,
    );

    const sync = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        shellDivider!.style.display = "none";
        return;
      }

      if (anchor.getClientRects().length === 0) {
        return;
      }

      const shellRect = shellSplit.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      let leftPx: number;
      if (dividerAnchorRef?.current) {
        leftPx = getWorkspaceToolsShellDividerLeftPxFromAnchor(
          shellSplit,
          dividerAnchorRef.current,
          dividerAnchorEdge,
        );
      } else {
        leftPx = getWorkspaceToolsShellDividerLeftPx(shellSplit);
      }
      const topPx =
        edge === "bottom"
          ? shellLocalLengthFromViewportDelta(anchorRect.bottom - shellRect.top - 1)
          : shellLocalLengthFromViewportDelta(anchorRect.top - shellRect.top);

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
    const dividerAnchor = dividerAnchorRef?.current;
    if (dividerAnchor) {
      resizeObserver.observe(dividerAnchor);
    }
    for (const watchRef of watchRefsRef.current) {
      const node = watchRef.current;
      if (node) {
        resizeObserver.observe(node);
      }
    }
    const onWindowResize = () => sync();
    window.addEventListener("resize", onWindowResize);

    const scrollViewport = anchor?.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    const onScroll = () => sync();
    scrollViewport?.addEventListener("scroll", onScroll, { passive: true });
    if (scrollViewport) {
      resizeObserver.observe(scrollViewport);
    }

    return () => {
      syncRef.current = null;
      resizeObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
      scrollViewport?.removeEventListener("scroll", onScroll);
      const ownerCount = (shellHorizontalDividerRefCounts.get(ownerKey) ?? 1) - 1;
      if (ownerCount <= 0) {
        shellHorizontalDividerRefCounts.delete(ownerKey);
        shellDivider!.style.display = "none";
      } else {
        shellHorizontalDividerRefCounts.set(ownerKey, ownerCount);
      }
    };
  }, [anchorRef, dividerAnchorEdge, dividerAnchorRef, dividerAttr, dividerKey, edge, enabled]);

  useLayoutEffect(() => {
    syncRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls layout invalidation
  }, layoutDeps);
}
