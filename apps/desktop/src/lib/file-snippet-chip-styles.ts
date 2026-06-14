import { workspaceFileBasename } from "@/lib/file-picker-path";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";

/** File snippet chip: structure aligned with terminal chip, emerald tint to distinguish from @file refs. */
export const FILE_SNIPPET_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-emerald-200/70 bg-emerald-50/80 px-1.5 py-0.5 text-xs font-medium leading-none text-emerald-900 select-none align-middle mx-0.5 dark:border-emerald-700/50 dark:bg-emerald-950/80 dark:text-emerald-300";

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

const FILE_SNIPPET_ICON_PATH =
  '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>';

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

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "10");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = FILE_SNIPPET_ICON_PATH;
  span.appendChild(icon);
  span.appendChild(
    doc.createTextNode(
      formatFileSnippetChipLabel(attachment.filePath, attachment.lineStart, attachment.lineEnd),
    ),
  );
  return span;
}
