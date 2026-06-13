import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { readDiffSelectionText } from "@/lib/pr-diff-selection";

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
}: UseTextSelectionActionMenuOptions) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<SelectionAnchorRect | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const selectionRef = useRef<Selection | null>(null);

  const syncFromSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!enabled || !root || !selection || selection.isCollapsed) {
      setOpen(false);
      setAnchor(null);
      setSelectionText("");
      selectionRef.current = null;
      return;
    }

    const text = readDiffSelectionText(selection);
    if (!text) {
      setOpen(false);
      setAnchor(null);
      setSelectionText("");
      selectionRef.current = null;
      return;
    }

    if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
      setOpen(false);
      setAnchor(null);
      setSelectionText("");
      selectionRef.current = null;
      return;
    }

    if (isSelectionAllowed && !isSelectionAllowed(selection, root)) {
      setOpen(false);
      setAnchor(null);
      setSelectionText("");
      selectionRef.current = null;
      return;
    }

    const nextAnchor = readSelectionAnchor(selection);
    if (!nextAnchor) {
      setOpen(false);
      setAnchor(null);
      setSelectionText("");
      selectionRef.current = null;
      return;
    }

    selectionRef.current = selection;
    setSelectionText(text);
    setAnchor(nextAnchor);
    setOpen(true);
  }, [enabled, isSelectionAllowed, rootRef]);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
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
    const onSelectionChange = () => {
      scheduleSync();
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
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, syncFromSelection]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setSelectionText("");
    selectionRef.current = null;
  }, []);

  return {
    open,
    setOpen,
    anchor,
    selectionText,
    dismiss,
    syncFromSelection,
  };
}
