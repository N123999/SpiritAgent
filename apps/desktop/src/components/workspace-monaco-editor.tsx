import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";

import { ensureMonacoWorkers } from "@/lib/monaco-environment";

const SPIRIT_MONACO_DARK = "spirit-desktop-dark";

/** Canvas 解析失败时的兜底；Monaco 主题合并路径只稳定接受 `#RRGGBB` / `#RRGGBBAA`。 */
const FALLBACK_DARK_BG = "#252525";
/** 深色 Monaco 编辑区底（与侧栏 `background` 区分边界；不跟随 `--card` 计算值）。 */
const MONACO_DARK_EDITOR_SURFACE = "#151515";
const FALLBACK_DARK_FG = "#fafafa";
const FALLBACK_MUTED_FG = "#a0a0a0";

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbaToMonacoHex(r: number, g: number, b: number, a: number): string {
  const R = clampByte(r).toString(16).padStart(2, "0");
  const G = clampByte(g).toString(16).padStart(2, "0");
  const B = clampByte(b).toString(16).padStart(2, "0");
  if (a >= 0.998) {
    return `#${R}${G}${B}`;
  }
  const A = clampByte(a * 255).toString(16).padStart(2, "0");
  return `#${R}${G}${B}${A}`;
}

/**
 * 将任意浏览器可解析的颜色（含 `oklch`、`color-mix`）转为 Monaco 主题用的 `#RRGGBB` / `#RRGGBBAA`。
 * `rgb(...)` 带空格等写法在 token 主题合并时会触发 Illegal value for token color。
 */
function normalizeColorForMonaco(cssColor: string, fallbackHex: string): string {
  const raw = cssColor.trim();
  const candidates = [raw, fallbackHex].filter(
    (c) => c.length > 0 && c !== "transparent" && c !== "rgba(0, 0, 0, 0)",
  );
  const cvs = document.createElement("canvas");
  cvs.width = 1;
  cvs.height = 1;
  const ctx = cvs.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return fallbackHex.startsWith("#") ? fallbackHex : FALLBACK_DARK_BG;
  }
  for (const c of candidates) {
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) {
        continue;
      }
      return rgbaToMonacoHex(d[0], d[1], d[2], d[3] / 255);
    } catch {
      /* 跳过非法串 */
    }
  }
  return fallbackHex.startsWith("#") ? fallbackHex : FALLBACK_DARK_BG;
}

/** 挂在 `documentElement` 上，确保继承 `html.dark` 下的 `--*` 变量（含 Mica 透明 body）。 */
function resolveCssBackground(expression: string, fallback: string): string {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;background:${expression};`;
  document.documentElement.appendChild(el);
  const resolved = getComputedStyle(el).backgroundColor;
  document.documentElement.removeChild(el);
  if (!resolved || resolved === "rgba(0, 0, 0, 0)" || resolved === "transparent") {
    return normalizeColorForMonaco(fallback, fallback);
  }
  return normalizeColorForMonaco(resolved, fallback);
}

function resolveCssColor(expression: string, fallback: string): string {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;color:${expression};`;
  document.documentElement.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.documentElement.removeChild(el);
  if (!resolved || resolved === "rgba(0, 0, 0, 0)" || resolved === "transparent") {
    return normalizeColorForMonaco(fallback, fallback);
  }
  return normalizeColorForMonaco(resolved, fallback);
}

/** 深色下 Monaco 画布固定色值，便于与侧栏分界；浅色仍用内置 `vs`。 */
function registerSpiritDesktopDarkMonacoTheme(): void {
  const editorSurface = MONACO_DARK_EDITOR_SURFACE;
  const fg = resolveCssColor("var(--foreground)", FALLBACK_DARK_FG);
  const mutedFg = resolveCssColor("var(--muted-foreground)", FALLBACK_MUTED_FG);
  const lineHighlight = resolveCssBackground(
    `color-mix(in oklab, var(--foreground) 8%, ${MONACO_DARK_EDITOR_SURFACE})`,
    editorSurface,
  );
  const selection = resolveCssBackground(
    "color-mix(in oklab, var(--accent) 50%, transparent)",
    "rgba(100, 100, 100, 0.35)",
  );
  const inactiveSelection = resolveCssBackground(
    "color-mix(in oklab, var(--accent) 28%, transparent)",
    "rgba(100, 100, 100, 0.2)",
  );
  const widgetBg = resolveCssBackground("var(--popover)", editorSurface);
  const border = resolveCssBackground("var(--border)", "rgba(128, 128, 128, 0.2)");

  try {
    monaco.editor.defineTheme(SPIRIT_MONACO_DARK, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": editorSurface,
        "editor.foreground": fg,
        "editorGutter.background": editorSurface,
        "editorLineNumber.foreground": mutedFg,
        "editorLineNumber.activeForeground": fg,
        "editor.lineHighlightBackground": lineHighlight,
        "editor.selectionBackground": selection,
        "editor.inactiveSelectionBackground": inactiveSelection,
        "editorCursor.foreground": fg,
        "editorWidget.background": widgetBg,
        "editorWidget.border": border,
        "scrollbarSlider.background": resolveCssBackground(
          "color-mix(in oklab, var(--foreground) 18%, transparent)",
          "rgba(121, 121, 121, 0.4)",
        ),
        "scrollbarSlider.hoverBackground": resolveCssBackground(
          "color-mix(in oklab, var(--foreground) 28%, transparent)",
          "rgba(100, 100, 100, 0.7)",
        ),
        "scrollbarSlider.activeBackground": resolveCssBackground(
          "color-mix(in oklab, var(--foreground) 35%, transparent)",
          "rgba(191, 191, 191, 0.4)",
        ),
      },
    });
  } catch {
    monaco.editor.defineTheme(SPIRIT_MONACO_DARK, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {},
    });
  }
}

function monacoLanguageId(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    md: "markdown",
    mdx: "markdown",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    html: "html",
    htm: "html",
    yml: "yaml",
    yaml: "yaml",
    rs: "rust",
    py: "python",
    toml: "ini",
    xml: "xml",
    svg: "xml",
    sql: "sql",
    sh: "shell",
    ps1: "powershell",
  };
  return map[ext] ?? "plaintext";
}

function syncMonacoThemeFromDocument(): void {
  const isDark = document.documentElement.classList.contains("dark");
  if (!isDark) {
    monaco.editor.setTheme("vs");
    return;
  }
  registerSpiritDesktopDarkMonacoTheme();
  monaco.editor.setTheme(SPIRIT_MONACO_DARK);
}

export type WorkspaceMonacoEditorHandle = {
  /** 将当前缓冲区写入磁盘；成功后会清除脏标记。 */
  save: () => Promise<void>;
};

export type WorkspaceMonacoEditorProps = {
  relativePath: string;
  initialText: string;
  onSave: (text: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};

export const WorkspaceMonacoEditor = forwardRef<
  WorkspaceMonacoEditorHandle,
  WorkspaceMonacoEditorProps
>(function WorkspaceMonacoEditor(
  { relativePath, initialText, onSave, onDirtyChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const baselineRef = useRef(initialText);
  const onSaveRef = useRef(onSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onSaveRef.current = onSave;
  onDirtyChangeRef.current = onDirtyChange;

  const runSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const value = editor.getValue();
    try {
      await onSaveRef.current(value);
      baselineRef.current = value;
      onDirtyChangeRef.current?.(false);
    } catch {
      /* 由上层展示错误；不更新 baseline */
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      save: () => runSave(),
    }),
    [runSave],
  );

  useEffect(() => {
    ensureMonacoWorkers();
    const root = containerRef.current;
    if (!root) {
      return;
    }
    syncMonacoThemeFromDocument();
    baselineRef.current = initialText;
    const editor = monaco.editor.create(root, {
      value: initialText,
      language: monacoLanguageId(relativePath),
      readOnly: false,
      minimap: { enabled: false },
      fontSize: 12,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: "line",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    });
    editorRef.current = editor;

    const dirtyDisposable = editor.onDidChangeModelContent(() => {
      onDirtyChangeRef.current?.(editor.getValue() !== baselineRef.current);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void runSave();
    });

    const obs = new MutationObserver(() => {
      syncMonacoThemeFromDocument();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      obs.disconnect();
      dirtyDisposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, [relativePath, initialText]);

  return <div ref={containerRef} className="h-full min-h-0 w-full min-w-0" />;
});
