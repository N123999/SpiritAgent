import type { ITheme, Terminal } from "@xterm/xterm";

const TERMINAL_CSS = {
  background: "--terminal-bg",
  foreground: "--terminal-fg",
  cursor: "--terminal-cursor",
  cursorAccent: "--terminal-cursor-accent",
  selectionBackground: "--terminal-selection-bg",
  black: "--terminal-ansi-black",
  red: "--terminal-ansi-red",
  green: "--terminal-ansi-green",
  yellow: "--terminal-ansi-yellow",
  blue: "--terminal-ansi-blue",
  magenta: "--terminal-ansi-magenta",
  cyan: "--terminal-ansi-cyan",
  white: "--terminal-ansi-white",
  brightBlack: "--terminal-ansi-bright-black",
  brightRed: "--terminal-ansi-bright-red",
  brightGreen: "--terminal-ansi-bright-green",
  brightYellow: "--terminal-ansi-bright-yellow",
  brightBlue: "--terminal-ansi-bright-blue",
  brightMagenta: "--terminal-ansi-bright-magenta",
  brightCyan: "--terminal-ansi-bright-cyan",
  brightWhite: "--terminal-ansi-bright-white",
} as const;

function cssVar(name: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || undefined;
}

/** 从 document 根上的 CSS 变量读取 xterm ITheme。 */
export function readTerminalThemeFromDocument(): ITheme {
  const theme: ITheme = {};
  for (const [key, varName] of Object.entries(TERMINAL_CSS)) {
    const value = cssVar(varName);
    if (value) {
      (theme as Record<string, string>)[key] = value;
    }
  }
  return theme;
}

export function applyTerminalTheme(term: Terminal): void {
  term.options.theme = readTerminalThemeFromDocument();
}

const liveTerminals = new Set<Terminal>();
let themeObserver: MutationObserver | undefined;

function ensureTerminalThemeObserver(): void {
  if (themeObserver || typeof document === "undefined") {
    return;
  }
  themeObserver = new MutationObserver(() => {
    for (const term of liveTerminals) {
      applyTerminalTheme(term);
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

export function trackTerminalTheme(term: Terminal): () => void {
  liveTerminals.add(term);
  ensureTerminalThemeObserver();
  applyTerminalTheme(term);
  return () => {
    liveTerminals.delete(term);
  };
}
