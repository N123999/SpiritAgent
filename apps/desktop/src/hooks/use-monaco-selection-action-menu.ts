import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { SelectionAnchorRect } from "@/hooks/use-text-selection-action-menu";
import type * as Monaco from "monaco-editor";

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;

type UseMonacoSelectionActionMenuOptions = {
  enabled?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** Monaco instance; use state (not ref) so listeners re-bind when editor becomes ready. */
  editor: MonacoEditor | null;
};

export function readMonacoSelectionLineRange(
  editor: MonacoEditor,
): { lineStart: number; lineEnd: number } | null {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    return null;
  }
  return {
    lineStart: Math.min(selection.startLineNumber, selection.endLineNumber),
    lineEnd: Math.max(selection.startLineNumber, selection.endLineNumber),
  };
}

export function readMonacoSelectionText(editor: MonacoEditor): string {
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || selection.isEmpty() || !model) {
    return "";
  }
  return model.getValueInRange(selection);
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

export function useMonacoSelectionActionMenu({
  enabled = true,
  containerRef,
  editor,
}: UseMonacoSelectionActionMenuOptions) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<SelectionAnchorRect | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [lineRange, setLineRange] = useState<{ lineStart: number; lineEnd: number } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setSelectionText("");
    setLineRange(null);
  }, []);

  const syncFromEditor = useCallback(() => {
    const container = containerRef.current;
    const activeEditor = editor;
    if (!enabled || !container || !activeEditor) {
      dismiss();
      return;
    }

    const text = readMonacoSelectionText(activeEditor).trim();
    if (!text) {
      dismiss();
      return;
    }

    const range = readMonacoSelectionLineRange(activeEditor);
    const pointer = lastPointerRef.current;
    const nextAnchor = pointer
      ? pointAnchor(pointer.x, pointer.y)
      : containerAnchor(container);

    setSelectionText(text);
    setLineRange(range);
    setAnchor(nextAnchor);
    setOpen(true);
  }, [containerRef, dismiss, editor, enabled]);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }

    const container = containerRef.current;
    const activeEditor = editor;
    if (!container || !activeEditor) {
      return;
    }

    let raf = 0;
    const scheduleSync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncFromEditor);
    };

    const onPointerUp = (event: MouseEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      scheduleSync();
    };

    const onSelectionChange = () => {
      const text = readMonacoSelectionText(activeEditor).trim();
      if (!text && !openRef.current) {
        dismiss();
        return;
      }
      if (text) {
        scheduleSync();
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
    const selectionDisposable = activeEditor.onDidChangeCursorSelection(onSelectionChange);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener("mouseup", onPointerUp);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("keyup", onKeyUp);
      selectionDisposable.dispose();
    };
  }, [containerRef, dismiss, editor, enabled, syncFromEditor]);

  return {
    open,
    setOpen,
    anchor,
    selectionText,
    lineRange,
    dismiss,
  };
}
