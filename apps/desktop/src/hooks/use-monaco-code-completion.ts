import { useEffect, useRef } from "react";

import * as monaco from "monaco-editor";

import { useHostApi } from "@/hooks/useHostApi";
import { monacoLanguageId } from "@/lib/monaco-language";
import type { CodeCompletionOperationSnapshot } from "@/types";

const COMPLETION_DEBOUNCE_MS = 600;
const JOURNAL_DEBOUNCE_MS = 500;

type PendingFetch = {
  position: monaco.Position;
  model: monaco.editor.ITextModel;
};

type CompletionCache = {
  line: number;
  column: number;
  items: monaco.languages.InlineCompletion[];
};

function positionsEqual(
  a: monaco.Position,
  b: monaco.Position,
): boolean {
  return a.lineNumber === b.lineNumber && a.column === b.column;
}

function isMonacoCanceled(error: unknown): boolean {
  if (error instanceof Error && error.name === "Canceled") {
    return true;
  }
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name?: string }).name === "Canceled";
  }
  return false;
}

const MAX_INLINE_INSERT_CHARS = 500;

/** 剥离换行与过长文本，供 inline ghost text 使用。 */
function sanitizeInlineInsertText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.length > MAX_INLINE_INSERT_CHARS
    ? firstLine.slice(0, MAX_INLINE_INSERT_CHARS)
    : firstLine;
}

/** 只保留光标处尚未输入的补全后缀，配合 point range 供 Monaco ghost text 渲染。 */
function completionSuffixAtCursor(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  insertText: string,
): string {
  const sanitized = sanitizeInlineInsertText(insertText);
  if (sanitized.length === 0) {
    return "";
  }
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  if (sanitized.startsWith(linePrefix)) {
    return sanitized.slice(linePrefix.length);
  }
  const maxOverlap = Math.min(linePrefix.length, sanitized.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (linePrefix.endsWith(sanitized.slice(0, overlap))) {
      return sanitized.slice(overlap);
    }
  }
  return sanitized;
}

function toInlineItem(
  operation: CodeCompletionOperationSnapshot,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.InlineCompletion | undefined {
  if (operation.kind === "insert") {
    const insertText = completionSuffixAtCursor(model, position, operation.text ?? "");
    if (insertText.length === 0) {
      return undefined;
    }
    return {
      range: monaco.Range.fromPositions(position),
      insertText,
    };
  }

  if (operation.kind === "replace") {
    const range = new monaco.Range(
      operation.startLine,
      operation.startColumn,
      operation.endLine,
      operation.endColumn,
    );
    const existing = model.getValueInRange(range);
    const nextText = sanitizeInlineInsertText(operation.text ?? "");
    if (nextText.length === 0) {
      return undefined;
    }
    const suffix = nextText.startsWith(existing)
      ? nextText.slice(existing.length)
      : nextText;
    if (suffix.length === 0) {
      return undefined;
    }
    return {
      range: monaco.Range.fromPositions(position),
      insertText: suffix,
    };
  }

  return undefined;
}

export function useMonacoCodeCompletion(options: {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  relativePath: string;
  enabled: boolean;
  readOnly: boolean;
  baselineText: string;
}): void {
  const { editor, relativePath, enabled, readOnly, baselineText } = options;
  const { api } = useHostApi();
  const relativePathRef = useRef(relativePath);
  const baselineRef = useRef(baselineText);
  const cacheRef = useRef<CompletionCache | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchTokenRef = useRef(0);
  const fetchInFlightRef = useRef(false);
  const pendingFetchRef = useRef<PendingFetch | null>(null);
  const scheduledTargetRef = useRef<{ line: number; column: number } | null>(null);

  relativePathRef.current = relativePath;
  baselineRef.current = baselineText;

  useEffect(() => {
    if (!editor || !api || readOnly || !enabled) {
      return;
    }

    const languageId = monacoLanguageId(relativePath);

    const executeFetch = async (
      requestPosition: monaco.Position,
      model: monaco.editor.ITextModel,
    ) => {
      const fetchToken = ++fetchTokenRef.current;
      await api.abortCodeCompletion();
      if (fetchToken !== fetchTokenRef.current) {
        return;
      }

      try {
        const result = await api.requestCodeCompletion({
          relativePath: relativePathRef.current,
          languageId,
          documentText: model.getValue(),
          cursorLine: requestPosition.lineNumber,
          cursorColumn: requestPosition.column,
        });

        if (fetchToken !== fetchTokenRef.current) {
          return;
        }

        const editorPosition = editor.getPosition();
        if (!editorPosition || !positionsEqual(editorPosition, requestPosition)) {
          return;
        }

        const operation = result.operations[0];
        if (!operation) {
          cacheRef.current = null;
          return;
        }

        const item = toInlineItem(operation, model, requestPosition);
        if (!item) {
          cacheRef.current = null;
          return;
        }

        cacheRef.current = {
          line: requestPosition.lineNumber,
          column: requestPosition.column,
          items: [item],
        };
        editor.trigger(null, "editor.action.inlineSuggest.trigger", {});
      } catch (error) {
        if (!isMonacoCanceled(error)) {
          console.debug("[code-completion] fetch failed:", error);
        }
      }
    };

    const drainFetchQueue = async () => {
      if (fetchInFlightRef.current) {
        return;
      }
      const pending = pendingFetchRef.current;
      if (!pending) {
        return;
      }
      pendingFetchRef.current = null;
      fetchInFlightRef.current = true;
      try {
        await executeFetch(pending.position, pending.model);
      } finally {
        fetchInFlightRef.current = false;
        if (pendingFetchRef.current) {
          void drainFetchQueue();
        }
      }
    };

    const scheduleFetch = (
      position: monaco.Position,
      model: monaco.editor.ITextModel,
    ) => {
      const target = { line: position.lineNumber, column: position.column };
      const alreadyScheduled =
        scheduledTargetRef.current?.line === target.line &&
        scheduledTargetRef.current?.column === target.column &&
        (debounceTimerRef.current !== undefined || fetchInFlightRef.current);
      if (alreadyScheduled) {
        return;
      }

      scheduledTargetRef.current = target;
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = undefined;
        pendingFetchRef.current = { position, model };
        if (fetchInFlightRef.current) {
          fetchTokenRef.current += 1;
          void api.abortCodeCompletion();
        }
        void drainFetchQueue();
      }, COMPLETION_DEBOUNCE_MS);
    };

    const provider = monaco.languages.registerInlineCompletionsProvider(languageId, {
      provideInlineCompletions: (model, position) => {
        const cache = cacheRef.current;
        if (
          cache &&
          cache.line === position.lineNumber &&
          cache.column === position.column
        ) {
          return { items: cache.items, enableForwardStability: true };
        }

        return { items: [] };
      },
      freeInlineCompletions: () => {},
    });

    const contentDisposable = editor.onDidChangeModelContent(() => {
      const position = editor.getPosition();
      const model = editor.getModel();
      if (!position || !model) {
        return;
      }
      cacheRef.current = null;
      scheduledTargetRef.current = null;
      scheduleFetch(position, model);
    });

    return () => {
      contentDisposable.dispose();
      if (debounceTimerRef.current !== undefined) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }
      provider.dispose();
      fetchTokenRef.current += 1;
      pendingFetchRef.current = null;
      fetchInFlightRef.current = false;
      scheduledTargetRef.current = null;
      cacheRef.current = null;
      void api.abortCodeCompletion();
    };
  }, [api, editor, enabled, readOnly, relativePath]);

  useEffect(() => {
    if (!editor || !api || readOnly || !enabled) {
      return;
    }

    let journalTimer: ReturnType<typeof setTimeout> | undefined;
    const disposable = editor.onDidChangeModelContent(() => {
      if (journalTimer !== undefined) {
        clearTimeout(journalTimer);
      }
      journalTimer = setTimeout(() => {
        void api.recordCodeCompletionFileState({
          relativePath: relativePathRef.current,
          baselineText: baselineRef.current,
          currentText: editor.getValue(),
        });
      }, JOURNAL_DEBOUNCE_MS);
    });

    return () => {
      if (journalTimer !== undefined) {
        clearTimeout(journalTimer);
      }
      disposable.dispose();
    };
  }, [api, editor, enabled, readOnly]);
}
