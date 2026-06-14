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
import { monacoLanguageId } from "@/lib/monaco-language";
import { syncMonacoThemeFromDocument } from "@/lib/monaco-theme";

export type WorkspaceMonacoEditorHandle = {
  /** 将当前缓冲区写入磁盘；成功后会清除脏标记。 */
  save: () => Promise<void>;
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
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
  onSaveRef.current = onSave;
  onDirtyChangeRef.current = onDirtyChange;
  onTextChangeRef.current = onTextChange;
  onEditorReadyRef.current = onEditorReady;

  useEffect(() => {
    if (baselineText !== undefined) {
      baselineRef.current = baselineText;
    }
  }, [baselineText]);

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
      readOnly,
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
    onEditorReadyRef.current?.(editor);

    const dirtyDisposable = editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      onTextChangeRef.current?.(value);
      onDirtyChangeRef.current?.(value !== baselineRef.current);
    });

    if (!readOnly) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void runSave();
      });
    }

    const obs = new MutationObserver(() => {
      syncMonacoThemeFromDocument();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      obs.disconnect();
      dirtyDisposable.dispose();
      onEditorReadyRef.current?.(null);
      editor.dispose();
      editorRef.current = null;
    };
  }, [relativePath, readOnly, runSave]);

  return <div ref={containerRef} className="h-full min-h-0 w-full min-w-0" />;
});
