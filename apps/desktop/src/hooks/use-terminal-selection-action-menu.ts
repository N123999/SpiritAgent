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
    if (!pointer) {
      dismiss();
      return;
    }

    setSelectionText(text);
    setLineRange(range);
    setAnchor(pointAnchor(pointer.x, pointer.y));
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

    container.addEventListener("mouseup", onPointerUp);
    const selectionDisposable = term.onSelectionChange(onSelectionChange);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("mouseup", onPointerUp);
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
