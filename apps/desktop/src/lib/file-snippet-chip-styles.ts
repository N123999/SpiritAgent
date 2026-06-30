import {
  COMPOSER_INLINE_CHIP_CLASS,
  COMPOSER_INLINE_CHIP_ICON_CLASS,
} from "@/lib/composer-inline-chip-styles";
import { appendWorkspaceFileIconSvg } from "@/lib/workspace-explorer-icon-dom";
import { workspaceFileBasename } from "@/lib/file-picker-path";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";

export const FILE_SNIPPET_CHIP_CLASS = COMPOSER_INLINE_CHIP_CLASS;

export const FILE_SNIPPET_CHIP_ICON_CLASS = COMPOSER_INLINE_CHIP_ICON_CLASS;

export function formatFileSnippetChipLabel(
  filePath: string,
  lineStart: number,
  lineEnd: number,
): string {
  const base = workspaceFileBasename(filePath.replace(/\\/gu, "/"));
  if (lineStart > 0 && lineEnd > 0) {
    return `${base} L${lineStart}-${lineEnd}`;
  }
  return base;
}

export function formatFileSnippetChipTitle(attachment: FileSnippetAttachment): string {
  const normalized = attachment.filePath.replace(/\\/gu, "/");
  const linePart =
    attachment.lineStart > 0 && attachment.lineEnd > 0
      ? ` — L${attachment.lineStart}-${attachment.lineEnd}`
      : "";
  return `${normalized}${linePart}`;
}

export function makeFileSnippetChipNode(attachment: FileSnippetAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.fileSnippetChip = "true";
  span.setAttribute("data-file-snippet-chip", "true");
  span.dataset.fileSnippetId = attachment.id;
  span.dataset.fileSnippetPath = attachment.filePath;
  span.dataset.fileSnippetLineStart = String(attachment.lineStart);
  span.dataset.fileSnippetLineEnd = String(attachment.lineEnd);
  span.dataset.fileSnippetText = attachment.selectedText;
  span.className = FILE_SNIPPET_CHIP_CLASS;
  span.title = formatFileSnippetChipTitle(attachment);
  span.setAttribute(
    "aria-label",
    formatFileSnippetChipLabel(attachment.filePath, attachment.lineStart, attachment.lineEnd),
  );

  appendWorkspaceFileIconSvg(span, doc, attachment.filePath, {
    size: 10,
    className: FILE_SNIPPET_CHIP_ICON_CLASS,
  }, 'file', { colorMode: 'inherit' });

  span.appendChild(
    doc.createTextNode(
      formatFileSnippetChipLabel(attachment.filePath, attachment.lineStart, attachment.lineEnd),
    ),
  );
  return span;
}
