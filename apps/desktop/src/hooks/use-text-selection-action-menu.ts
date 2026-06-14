import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { readPlainSelectionText } from "@/lib/pr-diff-selection";

export type SelectionAnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type UseTextSelectionActionMenuOptions = {
  enabled?: boolean;
  rootRef: RefObject<HTMLElement | null>;
  isSelectionAllowed?: (selection: Selection, root: HTMLElement) => boolean;
  readSelectionText?: (selection: Selection) => string;
};

function readSelectionAnchor(selection: Selection): SelectionAnchorRect | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return null;
  }
  return {
    x: rect.left,
    y: rect.top,
    width: Math.max(rect.width, 1),
    height: Math.max(rect.height, 1),
  };
}

export function useTextSelectionActionMenu({
  enabled = true,
  rootRef,
  isSelectionAllowed,
  readSelectionText = readPlainSelectionText,
}: UseTextSelectionActionMenuOptions) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<SelectionAnchorRect | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const selectionRef = useRef<Selection | null>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setSelectionText("");
    selectionRef.current = null;
  }, []);

  const syncFromSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!enabled || !root || !selection || selection.isCollapsed) {
      dismiss();
      return;
    }

    const text = readSelectionText(selection);
    if (!text) {
      dismiss();
      return;
    }

    if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
      dismiss();
      return;
    }

    if (isSelectionAllowed && !isSelectionAllowed(selection, root)) {
      dismiss();
      return;
    }

    const nextAnchor = readSelectionAnchor(selection);
    if (!nextAnchor) {
      dismiss();
      return;
    }

    selectionRef.current = selection;
    setSelectionText(text);
    setAnchor(nextAnchor);
    setOpen(true);
  }, [dismiss, enabled, isSelectionAllowed, readSelectionText, rootRef]);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }

    let raf = 0;
    const scheduleSync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncFromSelection);
    };

    const onMouseUp = () => {
      scheduleSync();
    };
    const onTouchEnd = () => {
      scheduleSync();
    };
    /** Dismiss when selection clears; do not open while the user is still dragging. */
    const onSelectionChange = () => {
      const selection = typeof window !== "undefined" ? window.getSelection() : null;
      const root = rootRef.current;
      if (!selection || selection.isCollapsed) {
        dismiss();
        return;
      }
      if (!root) {
        return;
      }
      const text = readSelectionText(selection);
      if (
        !text
        || !root.contains(selection.anchorNode)
        || !root.contains(selection.focusNode)
        || (isSelectionAllowed && !isSelectionAllowed(selection, root))
      ) {
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

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [dismiss, enabled, isSelectionAllowed, readSelectionText, rootRef, syncFromSelection]);

  return {
    open,
    setOpen,
    anchor,
    selectionText,
    dismiss,
    syncFromSelection,
  };
}
