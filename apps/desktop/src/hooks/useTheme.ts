import { useCallback, useEffect, useState } from "react";

import {
  applyThemeToDocument,
  getStoredTheme,
  setStoredTheme,
  type ThemePreference,
} from "@/lib/theme";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme());

  const setTheme = useCallback((next: ThemePreference) => {
    setStoredTheme(next);
    setThemeState(next);
    applyThemeToDocument(next);
  }, []);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      applyThemeToDocument("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => {
      mq.removeEventListener("change", onSystemChange);
    };
  }, [theme]);

  return { theme, setTheme };
}
