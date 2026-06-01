import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyThemeToDocument,
  getStoredTheme,
  setStoredTheme,
  systemPrefersDark,
  type ThemePreference,
} from "@/lib/theme";

export type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (next: ThemePreference) => void;
  resolvedDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

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
      setSystemDark(mq.matches);
      applyThemeToDocument("system");
    };
    setSystemDark(mq.matches);
    mq.addEventListener("change", onSystemChange);
    return () => {
      mq.removeEventListener("change", onSystemChange);
    };
  }, [theme]);

  const resolvedDark =
    theme === "dark" ? true : theme === "light" ? false : systemDark;

  const value = useMemo(
    () => ({ theme, setTheme, resolvedDark }),
    [theme, setTheme, resolvedDark],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
}
