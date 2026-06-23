import { useCallback, useState } from "react";

import {
  applyUiLayoutScaleToDocument,
  DEFAULT_UI_LAYOUT_SCALE,
  getStoredUiLayoutScale,
  setStoredUiLayoutScale,
  stepUiLayoutScale,
} from "@/lib/ui-layout-scale";

export function useUiLayoutScale() {
  const [scale, setScaleState] = useState(() => getStoredUiLayoutScale());

  const setScale = useCallback((next: number) => {
    setStoredUiLayoutScale(next);
    setScaleState(next);
    applyUiLayoutScaleToDocument(next);
  }, []);

  const zoomIn = useCallback(() => {
    setScaleState((current) => {
      const next = stepUiLayoutScale(current, "in");
      setStoredUiLayoutScale(next);
      applyUiLayoutScaleToDocument(next);
      return next;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setScaleState((current) => {
      const next = stepUiLayoutScale(current, "out");
      setStoredUiLayoutScale(next);
      applyUiLayoutScaleToDocument(next);
      return next;
    });
  }, []);

  const resetScale = useCallback(() => {
    setScale(DEFAULT_UI_LAYOUT_SCALE);
  }, [setScale]);

  return { scale, setScale, zoomIn, zoomOut, resetScale };
}
