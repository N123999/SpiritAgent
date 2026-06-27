import { useLayoutEffect, useState, type RefObject } from "react";

import type { ComposerRichInputHandle } from "@/components/composer-rich-input";

function normalizeAnchorRect(rect: DOMRect): DOMRect {
  return new DOMRect(
    rect.left,
    rect.top,
    Math.max(rect.width, 1),
    Math.max(rect.height, 1),
  );
}

export function useComposerSuggestionAnchor(
  richInputRef: RefObject<ComposerRichInputHandle | null>,
  plainTextOffset: number | null,
  composerFallbackRef: RefObject<HTMLElement | null>,
): DOMRect | null {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (plainTextOffset === null) {
      setAnchor(null);
      return;
    }

    const caretRect = richInputRef.current?.getPlainTextCaretClientRect(plainTextOffset);
    if (caretRect) {
      setAnchor(normalizeAnchorRect(caretRect));
      return;
    }

    const fallback = composerFallbackRef.current?.getBoundingClientRect();
    if (!fallback) {
      setAnchor(null);
      return;
    }

    setAnchor(new DOMRect(fallback.left, fallback.bottom - 1, 1, 1));
  }, [composerFallbackRef, plainTextOffset, richInputRef]);

  return anchor;
}
