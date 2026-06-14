import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";

/** 终端选区 chip：结构对齐元素 chip（圆角/边框/padding），配色保持低透明度中性底。 */
export const TERMINAL_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-border/50 bg-foreground/[0.05] px-1.5 py-0.5 text-xs font-medium leading-none text-muted-foreground select-none align-middle mx-0.5 dark:border-white/10 dark:bg-foreground/[0.08]";

const TERMINAL_ICON_PATH =
  '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>';

export function formatTerminalChipLabel(
  terminalName: string,
  lineStart: number,
  lineEnd: number,
): string {
  const name = terminalName.trim() || "Terminal";
  if (lineStart > 0 && lineEnd > 0) {
    return `${name} L${lineStart}-${lineEnd}`;
  }
  return name;
}

export function formatTerminalChipTitle(attachment: TerminalSnippetAttachment): string {
  const linePart =
    attachment.lineStart > 0 && attachment.lineEnd > 0
      ? ` — L${attachment.lineStart}-${attachment.lineEnd}`
      : "";
  return `${attachment.terminalName}${linePart}`;
}

export function makeTerminalChipNode(attachment: TerminalSnippetAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.terminalChip = "true";
  span.setAttribute("data-terminal-chip", "true");
  span.dataset.terminalId = attachment.id;
  span.dataset.terminalName = attachment.terminalName;
  span.dataset.terminalLineStart = String(attachment.lineStart);
  span.dataset.terminalLineEnd = String(attachment.lineEnd);
  span.dataset.terminalText = attachment.selectedText;
  span.className = TERMINAL_CHIP_CLASS;
  span.title = formatTerminalChipTitle(attachment);
  span.setAttribute(
    "aria-label",
    formatTerminalChipLabel(attachment.terminalName, attachment.lineStart, attachment.lineEnd),
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
  icon.innerHTML = TERMINAL_ICON_PATH;
  span.appendChild(icon);
  span.appendChild(
    doc.createTextNode(
      formatTerminalChipLabel(attachment.terminalName, attachment.lineStart, attachment.lineEnd),
    ),
  );
  return span;
}
