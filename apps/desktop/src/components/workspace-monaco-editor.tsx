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
  monaco.editor.setTheme(isDark ? "vs-dark" : "vs");
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
