import {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";
import { Pen } from "lucide-react";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { cn } from "@/lib/utils";

export type RichSegment =
  | { kind: "text"; value: string }
  | { kind: "element"; attachment: BrowserElementAttachment };

/**
 * Flatten the contenteditable div's DOM so that all children are either:
 * - text nodes
 * - br elements
 * - chip spans (data-element-chip)
 *
 * This prevents browsers from wrapping content in div/p containers when
 * typing or deleting near chip nodes.
 */
function normalizeDOM(root: HTMLElement): void {
  // Collect all top-level direct children that are block containers
  const toUnwrap: HTMLElement[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (!el.dataset.elementChip && (el.tagName === "DIV" || el.tagName === "P")) {
        toUnwrap.push(el);
      }
    }
  });

  for (const container of toUnwrap) {
    // Replace the container with its children
    const children = Array.from(container.childNodes);
    for (const child of children) {
      root.insertBefore(child, container);
    }
    container.remove();
  }

  // Merge adjacent text nodes
  root.normalize();

  // Remove all lone <br> nodes that are adjacent to chips or at boundaries.
  // A <br> is "lone" if it is next to a chip (or at start/end) and not serving
  // as a deliberate newline between two text nodes.
  const kids = Array.from(root.childNodes);
  const toRemoveBr: ChildNode[] = [];
  kids.forEach((node, i) => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
      const prev = kids[i - 1];
      const next = kids[i + 1];
      const prevIsText = prev?.nodeType === Node.TEXT_NODE;
      const nextIsText = next?.nodeType === Node.TEXT_NODE;
      // Keep <br> only when it sits between two text nodes (intentional newline).
      // Remove it when it is at start, at end, or adjacent to a chip.
      if (!(prevIsText && nextIsText)) {
        toRemoveBr.push(node);
      }
    }
  });
  toRemoveBr.forEach((n) => n.remove());

  // Remove comment nodes and whitespace-only text nodes introduced by HTML paste
  const toRemoveMisc: ChildNode[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      toRemoveMisc.push(node);
    } else if (node.nodeType === Node.TEXT_NODE && /^[\r\n\s]*$/.test(node.textContent ?? '')) {
      toRemoveMisc.push(node);
    }
  });
  toRemoveMisc.forEach((n) => n.remove());
}

/** Serialize contenteditable DOM → RichSegment[] (DOM must be normalized first) */
function domToSegments(root: HTMLElement): RichSegment[] {
  const segs: RichSegment[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.textContent ?? "";
      if (v) segs.push({ kind: "text", value: v });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const id = el.dataset.elementId;
      const tag = el.dataset.elementTag;
      const html = el.dataset.elementHtml;
      const url = el.dataset.elementUrl;
      if (id && tag && html !== undefined && url !== undefined) {
        segs.push({
          kind: "element",
          attachment: { id, tagName: tag, outerHtml: html, screenshotDataUrl: "", pageUrl: url },
        });
      } else if (el.tagName === "BR") {
        segs.push({ kind: "text", value: "\n" });
      }
      // block containers handled by normalizeDOM; ignore here
    }
  });
  // Strip trailing newline added by browsers
  const last = segs[segs.length - 1];
  if (last?.kind === "text" && last.value.endsWith("\n")) {
    last.value = last.value.slice(0, -1);
    if (!last.value) segs.pop();
  }
  return segs;
}

/** Serialize RichSegment[] → plain text (for sending) */
export function segmentsToPlainText(segs: RichSegment[]): string {
  return segs.map((s) => (s.kind === "text" ? s.value : "")).join("");
}

/** Extract all element attachments from segments */
export function segmentsToAttachments(segs: RichSegment[]): BrowserElementAttachment[] {
  return segs.filter((s): s is Extract<RichSegment, { kind: "element" }> => s.kind === "element").map((s) => s.attachment);
}

/** Build DOM from segments (used to reset contenteditable) */
function segmentsToDom(segs: RichSegment[], doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const seg of segs) {
    if (seg.kind === "text") {
      const lines = seg.value.split("\n");
      lines.forEach((line, i) => {
        if (line) frag.appendChild(doc.createTextNode(line));
        if (i < lines.length - 1) frag.appendChild(doc.createElement("br"));
      });
    } else {
      frag.appendChild(makeChipNode(seg.attachment, doc));
    }
  }
  return frag;
}

function makeChipNode(a: BrowserElementAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.elementId = a.id;
  span.dataset.elementTag = a.tagName;
  span.dataset.elementHtml = a.outerHtml;
  span.dataset.elementUrl = a.pageUrl;
  span.setAttribute("data-element-chip", "true");
  span.className =
    "inline-flex items-center gap-1 rounded-md border border-blue-700/60 bg-blue-950 px-1.5 py-0.5 text-xs font-medium leading-none text-blue-400 select-none align-middle mx-0.5";
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
  icon.innerHTML =
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>';
  span.appendChild(icon);
  const label = doc.createTextNode(`<${a.tagName}>`);
  span.appendChild(label);
  return span;
}

const ELEMENT_MIME = "application/x-spirit-elements";

type Props = {
  value: string;
  elementAttachments?: readonly BrowserElementAttachment[];
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  onTextChange(text: string): void;
  onElementAttachmentsChange(attachments: BrowserElementAttachment[]): void;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  onPaste?(e: ClipboardEvent<HTMLDivElement>): void;
};

export type ComposerRichInputHandle = {
  focus(): void;
  insertAttachment(a: BrowserElementAttachment): void;
  getSegments(): RichSegment[];
};

export const ComposerRichInput = forwardRef<ComposerRichInputHandle, Props>(
  function ComposerRichInput(
    { value, elementAttachments, placeholder, readOnly, className, onTextChange, onElementAttachmentsChange, onKeyDown, onPaste },
    ref,
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    const suppressNextSync = useRef(false);
    const justInsertedChipRef = useRef(false);
    const onElementAttachmentsChangeRef = useRef(onElementAttachmentsChange);
    useEffect(() => { onElementAttachmentsChangeRef.current = onElementAttachmentsChange; });

    const getSegments = useCallback((): RichSegment[] => {
      if (!divRef.current) return [];
      return domToSegments(divRef.current);
    }, []);

    const notify = useCallback(() => {
      const segs = getSegments();
      onTextChange(segmentsToPlainText(segs));
      onElementAttachmentsChange(segmentsToAttachments(segs));
    }, [getSegments, onTextChange, onElementAttachmentsChange]);

    const insertAttachment = useCallback((a: BrowserElementAttachment) => {
      const div = divRef.current;
      if (!div) return;
      div.focus();
      const sel = window.getSelection();
      const chip = makeChipNode(a, document);
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (div.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          range.insertNode(chip);
          range.setStartAfter(chip);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          div.appendChild(chip);
        }
      } else {
        div.appendChild(chip);
      }
      suppressNextSync.current = true;
      justInsertedChipRef.current = true;
      normalizeDOM(div);
      notify();
    }, [notify]);

    useImperativeHandle(ref, () => ({ focus: () => divRef.current?.focus(), insertAttachment, getSegments }), [insertAttachment, getSegments]);

    useEffect(() => {
      const div = divRef.current;
      if (!div) return;
      if (suppressNextSync.current) {
        suppressNextSync.current = false;
        return;
      }
      normalizeDOM(div);
      const currentSegs = domToSegments(div);
      const currentText = segmentsToPlainText(currentSegs);
      const currentHasChips = div.querySelector('[data-element-chip]') !== null;
      // When value is cleared externally (e.g. after send), also wipe chips.
      // But skip if we just inserted a chip (value may still be empty in that case).
      if (!value && currentHasChips) {
        if (justInsertedChipRef.current) {
          justInsertedChipRef.current = false;
          return;
        }
        div.innerHTML = '';
        onElementAttachmentsChangeRef.current([]);
        return;
      }
      justInsertedChipRef.current = false;
      if (currentText === value) return;
      // Rebuild text content; preserve chip nodes in place
      const chips = Array.from(div.querySelectorAll<HTMLElement>('[data-element-chip]'));
      div.innerHTML = '';
      if (value) div.appendChild(document.createTextNode(value));
      chips.forEach((c) => div.appendChild(c));
    }, [value]);

    const handleInput = useCallback(() => {
      const div = divRef.current;
      if (div) normalizeDOM(div);
      notify();
    }, [notify]);

    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }
    }, [onKeyDown]);

    const handleCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const frag = range.cloneContents();
      const chips: Record<string, BrowserElementAttachment> = {};
      frag.querySelectorAll("[data-element-chip]").forEach((el) => {
        const span = el as HTMLElement;
        const id = span.dataset.elementId ?? "";
        chips[id] = {
          id,
          tagName: span.dataset.elementTag ?? "",
          outerHtml: span.dataset.elementHtml ?? "",
          screenshotDataUrl: "",
          pageUrl: span.dataset.elementUrl ?? "",
        };
      });
      if (Object.keys(chips).length === 0) return;
      e.preventDefault();
      const textDiv = document.createElement("div");
      textDiv.appendChild(frag.cloneNode(true));
      const plainText = textDiv.innerText;
      e.nativeEvent.clipboardData?.setData("text/plain", plainText);
      e.nativeEvent.clipboardData?.setData(ELEMENT_MIME, JSON.stringify(chips));
      e.nativeEvent.clipboardData?.setData("text/html", textDiv.innerHTML);
    }, []);

    const handlePaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
      onPaste?.(e);
      if (e.defaultPrevented) return;
      const raw = e.nativeEvent.clipboardData?.getData(ELEMENT_MIME);
      if (!raw) return;
      e.preventDefault();
      try {
        const chips: Record<string, BrowserElementAttachment> = JSON.parse(raw);
        const html = e.nativeEvent.clipboardData?.getData("text/html") ?? "";
        const parser = new DOMParser();
        const parsed = parser.parseFromString(html, "text/html");
        const sel = window.getSelection();
        const div = divRef.current;
        if (!sel || !div) return;
        const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (range && div.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          const frag = document.createDocumentFragment();
          parsed.body.childNodes.forEach((node) => {
            // Skip comment nodes and whitespace-only text nodes from HTML boilerplate
            if (node.nodeType === Node.COMMENT_NODE) return;
            if (node.nodeType === Node.TEXT_NODE && /^[\r\n\s]*$/.test(node.textContent ?? '')) return;
            if ((node as HTMLElement).dataset?.elementChip === "true") {
              const span = node as HTMLElement;
              const id = span.dataset.elementId ?? "";
              if (chips[id]) {
                frag.appendChild(makeChipNode(chips[id], document));
              }
            } else {
              frag.appendChild(document.importNode(node, true));
            }
          });
          range.insertNode(frag);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        normalizeDOM(div);
        notify();
      } catch {
        // fall through to default paste
      }
    }, [notify, onPaste]);

    const isEmpty = !value && !(elementAttachments?.length);

    return (
      <div className="relative">
        {isEmpty && placeholder && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-2.5 text-sm leading-relaxed text-muted-foreground select-none"
          >
            {placeholder}
          </span>
        )}
        <div
          ref={divRef}
          contentEditable={readOnly ? false : true}
          suppressContentEditableWarning
          aria-multiline="true"
          aria-label={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCopy={handleCopy}
          onPaste={handlePaste}
          className={cn(
            "spirit-scroll block max-h-[12rem] min-h-[3rem] w-full overflow-y-auto rounded-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-sm leading-relaxed outline-none md:min-h-[3.5rem]",
            "whitespace-pre-wrap break-words",
            "[&>br:last-child]:hidden",
            className,
          )}
        />
      </div>
    );
  },
);

function saveSelection(root: HTMLElement): { startOffset: number; endOffset: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const preStart = range.cloneRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const startOffset = preStart.toString().length;
  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);
  return { startOffset, endOffset: preEnd.toString().length };
}

function restoreSelection(root: HTMLElement, saved: { startOffset: number; endOffset: number }) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let charIdx = 0;
  let startSet = false;
  function walk(node: Node): boolean {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (!startSet && charIdx + len >= saved.startOffset) {
        range.setStart(node, saved.startOffset - charIdx);
        startSet = true;
      }
      if (startSet && charIdx + len >= saved.endOffset) {
        range.setEnd(node, saved.endOffset - charIdx);
        return true;
      }
      charIdx += len;
    } else {
      for (const child of Array.from(node.childNodes)) {
        if (walk(child)) return true;
      }
    }
    return false;
  }
  walk(root);
  sel.removeAllRanges();
  sel.addRange(range);
}
