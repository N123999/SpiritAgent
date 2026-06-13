import { useLayoutEffect, useRef, type RefObject } from "react";

import {
  getWorkspaceToolsShellDividerLeftPx,
  getWorkspaceToolsShellSplit,
  WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR,
} from "@/lib/workspace-tools-panel-edge";

type UseWorkspaceToolsShellRowDividersOptions = {
  enabled?: boolean;
  dividerClassName?: string;
};

export function useWorkspaceToolsShellRowDividers(
  listRef: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
  { enabled = true, dividerClassName = "pointer-events-none absolute h-px bg-border/35" }:
    UseWorkspaceToolsShellRowDividersOptions = {},
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
      const leftPx = getWorkspaceToolsShellDividerLeftPx(shellSplit);
      const viewport = root.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
      const clipRect = viewport?.getBoundingClientRect() ?? root.getBoundingClientRect();

      clipHost!.style.display = "block";
      clipHost!.style.left = "0";
      clipHost!.style.right = "0";
      clipHost!.style.top = `${clipRect.top - shellRect.top}px`;
      clipHost!.style.height = `${clipRect.height}px`;

      const rows = Array.from(root.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const dividerCount = Math.max(0, rows.length - 1);

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
        divider.style.top = `${rowRect.bottom - clipRect.top - 1}px`;
      }

      for (let index = dividerCount; index < dividers.length; index += 1) {
        dividers[index]!.style.display = "none";
      }
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(root);
    resizeObserver.observe(shellSplit);

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
  }, [dividerClassName, enabled, listRef, ...deps]);
}
