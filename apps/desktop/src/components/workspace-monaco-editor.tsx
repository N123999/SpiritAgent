import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import "@/styles/monaco-editor-overrides.css";

import type { EditorFileRevealLocation } from "@/lib/workspace-editor-navigation";
import { ensureMonacoWorkers } from "@/lib/monaco-environment";
import { ensureMonacoShikiReady, isMonacoShikiReady } from "@/lib/monaco-shiki";
import { monacoLanguageId } from "@/lib/monaco-language";
import {
  applySpiritMonacoEditorTheme,
  syncMonacoThemeFromDocument,
} from "@/lib/monaco-theme";

export type WorkspaceMonacoEditorHandle = {
  /** 将当前缓冲区写入磁盘；成功后会清除脏标记。 */
  save: () => Promise<void>;
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
};

export type WorkspaceMonacoSearchMatchRange = {
  line: number;
  startColumn: number;
  endColumn: number;
};

export type WorkspaceMonacoEditorProps = {
  relativePath: string;
  initialText: string;
  baselineText?: string;
  onSave: (text: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onTextChange?: (text: string) => void;
  readOnly?: boolean;
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
  revealLocation?: EditorFileRevealLocation | null;
  searchMatchRanges?: readonly WorkspaceMonacoSearchMatchRange[];
};

export const WorkspaceMonacoEditor = forwardRef<
  WorkspaceMonacoEditorHandle,
  WorkspaceMonacoEditorProps
>(function WorkspaceMonacoEditor(
  {
    relativePath,
    initialText,
    baselineText,
    onSave,
    onDirtyChange,
    onTextChange,
    readOnly = false,
    onEditorReady,
    revealLocation = null,
    searchMatchRanges = [],
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const baselineRef = useRef(baselineText ?? initialText);
  const onSaveRef = useRef(onSave);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onTextChangeRef = useRef(onTextChange);
  const onEditorReadyRef = useRef(onEditorReady);
  const revealLocationRef = useRef(revealLocation);
  const searchMatchRangesRef = useRef(searchMatchRanges);
  const searchDecorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  onSaveRef.current = onSave;
  onDirtyChangeRef.current = onDirtyChange;
  onTextChangeRef.current = onTextChange;
  onEditorReadyRef.current = onEditorReady;
  revealLocationRef.current = revealLocation;
  searchMatchRangesRef.current = searchMatchRanges;

  useEffect(() => {
    if (baselineText !== undefined) {
      baselineRef.current = baselineText;
    }
  }, [baselineText]);

  const applyRevealLocation = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    const reveal = revealLocationRef.current;
    if (!reveal || reveal.line < 1) {
      return;
    }
    const column = Math.max(1, reveal.column ?? 1);
    const position = { lineNumber: reveal.line, column };
    editor.setPosition(position);
    editor.revealLineInCenter(reveal.line);
    editor.focus();
  }, []);

  const runSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const value = editor.getValue();
    try {
      await onSaveRef.current(value);
      baselineRef.current = value;
      onTextChangeRef.current?.(value);
      onDirtyChangeRef.current?.(false);
    } catch {
      /* 由上层展示错误；不更新 baseline */
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      save: () => runSave(),
      getEditor: () => editorRef.current,
    }),
    [runSave],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const ranges = searchMatchRangesRef.current;
    searchDecorationsRef.current?.clear();
    if (ranges.length === 0) {
      searchDecorationsRef.current = null;
      return;
    }
    searchDecorationsRef.current = editor.createDecorationsCollection(
      ranges.map((range) => ({
        range: new monaco.Range(range.line, range.startColumn, range.line, range.endColumn),
        options: {
          className: "spirit-monaco-search-match",
        },
      })),
    );
  }, [searchMatchRanges]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealLocation) {
      return;
    }
    applyRevealLocation(editor);
  }, [applyRevealLocation, revealLocation, initialText]);

  useEffect(() => {
    ensureMonacoWorkers();
    const root = containerRef.current;
    if (!root) {
      return;
    }

    const mountInitialText = initialText;

    let disposed = false;
    let obs: MutationObserver | null = null;
    let dirtyDisposable: monaco.IDisposable | null = null;
    let editor: monaco.editor.IStandaloneCodeEditor | null = null;

    void (async () => {
      try {
        await ensureMonacoShikiReady();
      } catch {
        /* initMonacoShiki 已记录错误；回退为 Monaco 内置 tokenizer + Shiki 主题色 */
      }
      if (disposed || !containerRef.current) {
        return;
      }
      if (isMonacoShikiReady()) {
        syncMonacoThemeFromDocument();
      } else {
        applySpiritMonacoEditorTheme();
      }
      baselineRef.current = mountInitialText;
      editor = monaco.editor.create(containerRef.current, {
        value: mountInitialText,
        language: monacoLanguageId(relativePath),
        readOnly,
        minimap: { enabled: false },
        fontSize: 12,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        automaticLayout: true,
        tabSize: 2,
        renderLineHighlight: "line",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });
      editorRef.current = editor;
      onEditorReadyRef.current?.(editor);
      if (revealLocationRef.current) {
        applyRevealLocation(editor);
      }

      dirtyDisposable = editor.onDidChangeModelContent(() => {
        const value = editor!.getValue();
        onTextChangeRef.current?.(value);
        onDirtyChangeRef.current?.(value !== baselineRef.current);
      });

      if (!readOnly) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          void runSave();
        });
      }

      obs = new MutationObserver(() => {
        if (isMonacoShikiReady()) {
          syncMonacoThemeFromDocument();
        } else {
          applySpiritMonacoEditorTheme();
        }
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    })();

    return () => {
      disposed = true;
      obs?.disconnect();
      dirtyDisposable?.dispose();
      searchDecorationsRef.current?.clear();
      searchDecorationsRef.current = null;
      onEditorReadyRef.current?.(null);
      editor?.dispose();
      editorRef.current = null;
    };
  }, [applyRevealLocation, relativePath, readOnly, runSave]);

  return <div ref={containerRef} className="h-full min-h-0 w-full min-w-0" />;
});
