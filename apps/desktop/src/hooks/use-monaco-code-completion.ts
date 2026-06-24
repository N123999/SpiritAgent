import { useEffect, useRef } from "react";

import { codeCompletionOperationToInlineItemAtCursor } from "@spirit-agent/core";
import type { CodeCompletionOperation } from "@spirit-agent/core";
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

function toInlineItem(
  operation: CodeCompletionOperationSnapshot,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.InlineCompletion | undefined {
  const spec = codeCompletionOperationToInlineItemAtCursor(
    operation as CodeCompletionOperation,
    {
      lineText: model.getLineContent(position.lineNumber),
      cursorLine: position.lineNumber,
      cursorColumn: position.column,
    },
  );
  if (!spec) {
    return undefined;
  }
  return {
    range: new monaco.Range(
      spec.startLineNumber,
      spec.startColumn,
      spec.endLineNumber,
      spec.endColumn,
    ),
    insertText: spec.insertText,
  };
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
