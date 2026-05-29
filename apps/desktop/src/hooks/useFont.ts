import { useCallback, useState } from "react";

import {
  applyFontToDocument,
  getStoredFont,
  setStoredFont,
  type FontPreference,
} from "@/lib/font";

export function useFont() {
  const [font, setFontState] = useState<FontPreference>(() => getStoredFont());

  const setFont = useCallback((next: FontPreference) => {
    setStoredFont(next);
    setFontState(next);
    applyFontToDocument(next);
  }, []);

  return { font, setFont };
}
