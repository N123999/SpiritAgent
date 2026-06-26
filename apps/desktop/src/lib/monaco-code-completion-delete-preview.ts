import * as monaco from "monaco-editor";

import type { InlineDeleteDiffPreviewSpec } from "@spirit-agent/core/code-completion-delete-diff";

const WIDGET_ID = "spirit.codeCompletion.deletePreview";

export class DeleteDiffPreviewWidget implements monaco.editor.IContentWidget {
  private readonly domNode: HTMLElement;
  private spec: InlineDeleteDiffPreviewSpec;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    spec: InlineDeleteDiffPreviewSpec,
  ) {
    this.editor = editor;
    this.spec = spec;
    this.domNode = document.createElement("pre");
    this.domNode.className = "spirit-code-completion-delete-preview";
    this.domNode.textContent = spec.previewText;
  }

  updateSpec(spec: InlineDeleteDiffPreviewSpec): void {
    this.spec = spec;
    this.domNode.textContent = spec.previewText;
    this.editor.layoutContentWidget(this);
  }

  getId(): string {
    return WIDGET_ID;
  }

  getDomNode(): HTMLElement {
    return this.domNode;
  }

  getPosition(): monaco.editor.IContentWidgetPosition | null {
    if (this.spec.previewText.length === 0) {
      return null;
    }

    const startLine = this.spec.startLineNumber;
    const endLine = this.spec.endLineNumber;
    let anchorColumn = 1;
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      anchorColumn = Math.max(anchorColumn, this.editor.getModel()?.getLineMaxColumn(lineNumber) ?? 1);
    }

    return {
      position: {
        lineNumber: this.spec.anchorLineNumber,
        column: anchorColumn,
      },
      preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
    };
  }
}

export function deletePreviewDecoration(
  spec: InlineDeleteDiffPreviewSpec,
): monaco.editor.IModelDeltaDecoration {
  return {
    range: new monaco.Range(
      spec.startLineNumber,
      spec.startColumn,
      spec.endLineNumber,
      spec.endColumn,
    ),
    options: {
      inlineClassName: "spirit-code-completion-delete",
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  };
}

export function applyDeletePreviewEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  spec: InlineDeleteDiffPreviewSpec,
): void {
  editor.executeEdits("spirit-code-completion-delete", [
    {
      range: new monaco.Range(
        spec.startLineNumber,
        spec.startColumn,
        spec.endLineNumber,
        spec.endColumn,
      ),
      text: "",
    },
  ]);
}

export { WIDGET_ID as DELETE_DIFF_PREVIEW_WIDGET_ID };
