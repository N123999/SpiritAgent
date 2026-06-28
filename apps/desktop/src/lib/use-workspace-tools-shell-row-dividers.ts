import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  getWorkspaceToolsShellDividerLeftPx,
  getWorkspaceToolsShellSplit,
  shellLocalLengthFromViewportDelta,
  WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR,
} from "@/lib/workspace-tools-panel-edge";

type UseWorkspaceToolsShellRowDividersOptions = {
  enabled?: boolean;
  /** Draw a divider below the last row when there is no trailing sibling. */
  trailingDivider?: boolean;
  dividerClassName?: string;
  /** When set, horizontal dividers start at this element's left edge instead of the shell resize line. */
  dividerAnchorRef?: RefObject<HTMLElement | null>;
  /** Which edge of `dividerAnchorRef` to align divider start. */
  dividerAnchorEdge?: "left" | "right";
  /** Observe layout changes on this element to re-sync divider left offset (e.g. sibling panel resize). */
  layoutWatchRef?: RefObject<HTMLElement | null>;
};

export function useWorkspaceToolsShellRowDividers(
  listRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
  {
    enabled = true,
    trailingDivider = false,
    dividerClassName = "pointer-events-none absolute h-px bg-border/35",
    dividerAnchorRef,
    dividerAnchorEdge = "left",
    layoutWatchRef,
  }: UseWorkspaceToolsShellRowDividersOptions = {},
) {
  const hostIdRef = useRef(`shell-list-dividers-${Math.random().toString(36).slice(2)}`);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const root = listRef.current;
    const shellSplit = getWorkspaceToolsShellSplit();
    if (!root || !shellSplit) {
      return;
    }

    const hostId = hostIdRef.current;
    let clipHost = shellSplit.querySelector<HTMLElement>(
      `[${WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR}="${hostId}"]`,
    );
    if (!clipHost) {
      clipHost = document.createElement("div");
      clipHost.setAttribute(WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR, hostId);
      clipHost.className = "pointer-events-none absolute z-10 overflow-hidden";
      shellSplit.appendChild(clipHost);
    }

    const dividers: HTMLElement[] = [];

    const sync = () => {
      const shellRect = shellSplit.getBoundingClientRect();
      let leftPx: number;
      if (dividerAnchorRef) {
        const anchor = dividerAnchorRef.current;
        if (!anchor) {
          for (const divider of dividers) {
            divider.style.display = "none";
          }
          return;
        }
        leftPx = shellLocalLengthFromViewportDelta(
          Math.max(
            0,
            (dividerAnchorEdge === "right"
              ? anchor.getBoundingClientRect().right
              : anchor.getBoundingClientRect().left) - shellRect.left,
          ),
        );
      } else {
        leftPx = getWorkspaceToolsShellDividerLeftPx(shellSplit);
      }
      const viewport = root.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
      const clipRect = viewport?.getBoundingClientRect() ?? root.getBoundingClientRect();

      clipHost!.style.display = "block";
      clipHost!.style.left = "0";
      clipHost!.style.right = "0";
      clipHost!.style.top = `${shellLocalLengthFromViewportDelta(clipRect.top - shellRect.top)}px`;
      clipHost!.style.height = `${shellLocalLengthFromViewportDelta(clipRect.height)}px`;

      const rows = Array.from(root.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const dividerCount = Math.max(
        0,
        rows.length - 1 + (trailingDivider && rows.length > 0 ? 1 : 0),
      );

      while (dividers.length < dividerCount) {
        const divider = document.createElement("div");
        divider.className = dividerClassName;
        clipHost!.appendChild(divider);
        dividers.push(divider);
      }

      for (let index = 0; index < dividerCount; index += 1) {
        const rowRect = rows[index]!.getBoundingClientRect();
        const divider = dividers[index]!;
        divider.style.display = "block";
        divider.style.left = `${leftPx}px`;
        divider.style.right = "0";
        divider.style.top = `${shellLocalLengthFromViewportDelta(rowRect.bottom - clipRect.top - 1)}px`;
      }

      for (let index = dividerCount; index < dividers.length; index += 1) {
        dividers[index]!.style.display = "none";
      }
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(root);
    resizeObserver.observe(shellSplit);
    const dividerAnchor = dividerAnchorRef?.current;
    if (dividerAnchor) {
      resizeObserver.observe(dividerAnchor);
    }
    const layoutWatch = layoutWatchRef?.current;
    if (layoutWatch) {
      resizeObserver.observe(layoutWatch);
    }

    const viewport = root.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
    viewport?.addEventListener("scroll", sync, { passive: true });
    if (viewport) {
      resizeObserver.observe(viewport);
    }
    window.addEventListener("resize", sync);

    return () => {
      resizeObserver.disconnect();
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      clipHost!.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller controls invalidation via deps
  }, [dividerAnchorEdge, dividerAnchorRef, dividerClassName, enabled, layoutWatchRef, listRef, trailingDivider, ...deps]);
}
