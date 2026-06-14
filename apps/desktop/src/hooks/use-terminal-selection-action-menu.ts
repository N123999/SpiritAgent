import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { SelectionAnchorRect } from "@/hooks/use-text-selection-action-menu";
import type { Terminal } from "@xterm/xterm";

type UseTerminalSelectionActionMenuOptions = {
  enabled?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** xterm instance; use state (not ref) so listeners re-bind when terminal becomes ready. */
  terminal: Terminal | null;
};

export function readTerminalSelectionLineRange(
  term: Terminal,
): { lineStart: number; lineEnd: number } | null {
  const position = term.getSelectionPosition();
  if (!position) {
    return null;
  }
  const lineStart = Math.min(position.start.y, position.end.y) + 1;
  const lineEnd = Math.max(position.start.y, position.end.y) + 1;
  return { lineStart, lineEnd };
}

function pointAnchor(x: number, y: number): SelectionAnchorRect {
  return { x, y, width: 1, height: 1 };
}

function containerAnchor(container: HTMLElement): SelectionAnchorRect {
  const rect = container.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: 1,
    height: 1,
  };
}

export function useTerminalSelectionActionMenu({
  enabled = true,
  containerRef,
  terminal,
}: UseTerminalSelectionActionMenuOptions) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<SelectionAnchorRect | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [lineRange, setLineRange] = useState<{ lineStart: number; lineEnd: number } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setSelectionText("");
    setLineRange(null);
  }, []);

  const syncFromTerminal = useCallback(() => {
    const container = containerRef.current;
    const term = terminal;
    if (!enabled || !container || !term) {
      dismiss();
      return;
    }

    const text = term.getSelection();
    if (!text.trim()) {
      dismiss();
      return;
    }

    const range = readTerminalSelectionLineRange(term);
    const pointer = lastPointerRef.current;
    const nextAnchor = pointer
      ? pointAnchor(pointer.x, pointer.y)
      : containerAnchor(container);

    setSelectionText(text);
    setLineRange(range);
    setAnchor(nextAnchor);
    setOpen(true);
  }, [containerRef, dismiss, enabled, terminal]);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }

    const container = containerRef.current;
    const term = terminal;
    if (!container || !term) {
      return;
    }

    let raf = 0;
    const scheduleSync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncFromTerminal);
    };

    const onPointerUp = (event: MouseEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleSync();
    };

    const onSelectionChange = () => {
      if (!term.getSelection().trim()) {
        dismiss();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === "Shift"
        || event.key.startsWith("Arrow")
        || event.key === "Home"
        || event.key === "End"
        || event.key === "PageUp"
        || event.key === "PageDown"
      ) {
        scheduleSync();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }
      lastPointerRef.current = { x: touch.clientX, y: touch.clientY };
      scheduleSync();
    };

    container.addEventListener("mouseup", onPointerUp);
    container.addEventListener("touchend", onTouchEnd);
    container.addEventListener("keyup", onKeyUp);
    const selectionDisposable = term.onSelectionChange(onSelectionChange);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("mouseup", onPointerUp);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("keyup", onKeyUp);
      selectionDisposable.dispose();
    };
  }, [containerRef, dismiss, enabled, syncFromTerminal, terminal]);

  return {
    open,
    setOpen,
    anchor,
    selectionText,
    lineRange,
    dismiss,
  };
}
