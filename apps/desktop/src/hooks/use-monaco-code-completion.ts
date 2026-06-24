import { useEffect, useRef } from "react";

import * as monaco from "monaco-editor";

import { useHostApi } from "@/hooks/useHostApi";
import { monacoLanguageId } from "@/lib/monaco-language";
import type { CodeCompletionOperationSnapshot } from "@/types";

const COMPLETION_DEBOUNCE_MS = 300;
const JOURNAL_DEBOUNCE_MS = 500;

function isMonacoCanceled(error: unknown): boolean {
  if (error instanceof Error && error.name === "Canceled") {
    return true;
  }
  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name?: string }).name === "Canceled";
  }
  return false;
}

function toInlineItem(operation: CodeCompletionOperationSnapshot): monaco.languages.InlineCompletion {
  return {
    range: new monaco.Range(
      operation.startLine,
      operation.startColumn,
      operation.endLine,
      operation.endColumn,
    ),
    insertText: operation.kind === "delete" ? "" : (operation.text ?? ""),
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
  const requestGenerationRef = useRef(0);

  relativePathRef.current = relativePath;
  baselineRef.current = baselineText;

  useEffect(() => {
    if (!editor || !api || readOnly || !enabled) {
      return;
    }

    const languageId = monacoLanguageId(relativePath);
    const provider = monaco.languages.registerInlineCompletionsProvider(languageId, {
      provideInlineCompletions: async (model, position, _context, token) => {
        const generation = ++requestGenerationRef.current;
        await api.abortCodeCompletion();

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, COMPLETION_DEBOUNCE_MS);
        });

        if (token.isCancellationRequested || generation !== requestGenerationRef.current) {
          return { items: [] };
        }

        try {
          const result = await api.requestCodeCompletion({
            relativePath: relativePathRef.current,
            languageId,
            documentText: model.getValue(),
            cursorLine: position.lineNumber,
            cursorColumn: position.column,
          });

          if (token.isCancellationRequested || generation !== requestGenerationRef.current) {
            return { items: [] };
          }

          const operation = result.operations[0];
          if (!operation) {
            return { items: [] };
          }

          return { items: [toInlineItem(operation)] };
        } catch (error) {
          if (isMonacoCanceled(error)) {
            return { items: [] };
          }
          return { items: [] };
        }
      },
      freeInlineCompletions: () => {},
    });

    return () => {
      provider.dispose();
      requestGenerationRef.current += 1;
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
