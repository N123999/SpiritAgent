import {
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useState,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type ClipboardEvent,
} from "react";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { caretToDomRange, selectionToCaret } from "@/lib/composer-segment-selection";
import { caretAtEnd } from "@/lib/composer-segment-model";
import {
  domToSegments,
  emptySegments,
  insertSegmentAtCaret,
  mergeAdjacentTextSegments,
  renderSegmentsToElement,
  segmentsEqual,
  segmentsToAttachments,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  type RichSegment,
  type SegmentCaret,
} from "@/lib/composer-segments";
import { cn } from "@/lib/utils";

export type { RichSegment } from "@/lib/composer-segment-model";
export {
  segmentsToAttachments,
  segmentsToMessageText,
  segmentsToPlainText,
} from "@/lib/composer-segment-model";

const ELEMENT_MIME = "application/x-spirit-elements";

type Props = {
  value: string;
  elementAttachments?: readonly BrowserElementAttachment[];
  /** One-shot hydrate (e.g. message rewind); ignored after first apply per mount. */
  initialSegments?: readonly RichSegment[] | null;
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
  setSegments(segments: RichSegment[]): void;
};

export const ComposerRichInput = forwardRef<ComposerRichInputHandle, Props>(
  function ComposerRichInput(
    {
      value,
      elementAttachments,
      initialSegments,
      placeholder,
      readOnly,
      className,
      onTextChange,
      onElementAttachmentsChange,
      onKeyDown,
      onPaste,
    },
    ref,
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    const [segments, setSegments] = useState<RichSegment[]>(() =>
      initialSegments?.length
        ? mergeAdjacentTextSegments([...initialSegments])
        : emptySegments(),
    );
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const pendingCaretRef = useRef<SegmentCaret | null>(null);
    const skipExternalValueSyncRef = useRef(Boolean(initialSegments?.length));
    const skipRenderRef = useRef(false);
    const initialSegmentsHydratedRef = useRef(Boolean(initialSegments?.length));
    const onElementAttachmentsChangeRef = useRef(onElementAttachmentsChange);

    useEffect(() => {
      segmentsRef.current = segments;
    }, [segments]);

    useEffect(() => {
      onElementAttachmentsChangeRef.current = onElementAttachmentsChange;
    });

    const notifyParents = useCallback(
      (next: RichSegment[]) => {
        skipExternalValueSyncRef.current = true;
        onTextChange(segmentsToPlainText(next));
        onElementAttachmentsChange(segmentsToAttachments(next));
      },
      [onTextChange, onElementAttachmentsChange],
    );

    const commitSegments = useCallback(
      (
        next: RichSegment[],
        caret?: SegmentCaret | null,
        options?: { notifyParent?: boolean },
      ) => {
        const merged = mergeAdjacentTextSegments(next);
        segmentsRef.current = merged;
        pendingCaretRef.current = caret ?? null;
        setSegments(merged);
        if (options?.notifyParent !== false) {
          notifyParents(merged);
        }
      },
      [notifyParents],
    );

    const getSegments = useCallback((): RichSegment[] => segmentsRef.current, []);

    const insertAttachment = useCallback(
      (a: BrowserElementAttachment) => {
        const div = divRef.current;
        if (!div) return;
        div.focus();
        const current = segmentsRef.current;
        const caret =
          selectionToCaret(div, current) ?? {
            segmentIndex: current.length - 1,
            offset: segmentsToPlainText(current).length,
          };
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, {
          kind: "element",
          attachment: a,
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const applySegments = useCallback(
      (next: RichSegment[], caret?: SegmentCaret | null, notifyParent = true) => {
        commitSegments(next, caret ?? caretAtEnd(mergeAdjacentTextSegments(next)), {
          notifyParent,
        });
      },
      [commitSegments],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => divRef.current?.focus(),
        insertAttachment,
        getSegments,
        setSegments: (next: RichSegment[]) => applySegments(next),
      }),
      [insertAttachment, getSegments, applySegments],
    );

    useLayoutEffect(() => {
      if (!initialSegments?.length || initialSegmentsHydratedRef.current) {
        return;
      }
      initialSegmentsHydratedRef.current = true;
      const merged = mergeAdjacentTextSegments([...initialSegments]);
      if (!segmentsEqual(merged, segmentsRef.current)) {
        skipExternalValueSyncRef.current = true;
        applySegments(merged, caretAtEnd(merged), false);
      }
    }, [initialSegments, applySegments]);

    useLayoutEffect(() => {
      const div = divRef.current;
      if (!div || skipRenderRef.current) {
        skipRenderRef.current = false;
        return;
      }

      const domSegs = domToSegments(div);
      if (segmentsEqual(domSegs, segments)) {
        if (pendingCaretRef.current) {
          caretToDomRange(div, segments, pendingCaretRef.current);
          pendingCaretRef.current = null;
        }
        return;
      }

      renderSegmentsToElement(div, segments);
      if (pendingCaretRef.current) {
        caretToDomRange(div, segments, pendingCaretRef.current);
        pendingCaretRef.current = null;
      }
    }, [segments]);

    useEffect(() => {
      if (skipExternalValueSyncRef.current) {
        skipExternalValueSyncRef.current = false;
        return;
      }

      const current = segmentsRef.current;
      const plain = segmentsToPlainText(current);
      const hasElements = current.some((s) => s.kind === "element");
      const attachmentCount = elementAttachments?.length ?? 0;

      if (
        attachmentCount > 0 &&
        !hasElements &&
        initialSegments?.some((s) => s.kind === "element")
      ) {
        skipExternalValueSyncRef.current = true;
        const merged = mergeAdjacentTextSegments([...initialSegments]);
        applySegments(merged, caretAtEnd(merged), false);
        return;
      }

      // Parent cleared composer after send: empty value AND no attachments prop.
      if (!value && attachmentCount === 0 && (plain || hasElements)) {
        commitSegments(emptySegments(), { segmentIndex: 0, offset: 0 });
        return;
      }

      if (plain === value) return;

      const next = syncSegmentsFromExternalValue(current, value);
      if (!segmentsEqual(next, current)) {
        pendingCaretRef.current = null;
        segmentsRef.current = next;
        setSegments(next);
      }
    }, [value, elementAttachments?.length, initialSegments, applySegments, commitSegments]);

    const handleInput = useCallback(() => {
      const div = divRef.current;
      if (!div) return;
      skipRenderRef.current = true;
      const caret = selectionToCaret(div, segmentsRef.current);
      const next = mergeAdjacentTextSegments(domToSegments(div));
      pendingCaretRef.current = caret;
      segmentsRef.current = next;
      setSegments(next);
      notifyParents(next);
    }, [notifyParents]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
        }
      },
      [onKeyDown],
    );

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
      e.nativeEvent.clipboardData?.setData("text/plain", textDiv.innerText);
      e.nativeEvent.clipboardData?.setData(ELEMENT_MIME, JSON.stringify(chips));
      e.nativeEvent.clipboardData?.setData("text/html", textDiv.innerHTML);
    }, []);

    const handlePaste = useCallback(
      (e: ClipboardEvent<HTMLDivElement>) => {
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
          const div = divRef.current;
          if (!div) return;

          const pasteSegs: RichSegment[] = [];
          parsed.body.childNodes.forEach((node) => {
            if (node.nodeType === Node.COMMENT_NODE) return;
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent ?? "";
              if (text) pasteSegs.push({ kind: "text", value: text });
              return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as HTMLElement;
              if (el.dataset?.elementChip === "true") {
                const id = el.dataset.elementId ?? "";
                if (chips[id]) {
                  pasteSegs.push({ kind: "element", attachment: chips[id] });
                }
              } else if (el.tagName === "BR") {
                mergeTextIntoPaste(pasteSegs, "\n");
              } else if (el.tagName === "DIV" || el.tagName === "P") {
                el.childNodes.forEach((child) => {
                  if (child.nodeType === Node.TEXT_NODE && child.textContent) {
                    pasteSegs.push({ kind: "text", value: child.textContent });
                  }
                });
              }
            }
          });

          const caret =
            selectionToCaret(div, segmentsRef.current) ?? { segmentIndex: 0, offset: 0 };
          let next = segmentsRef.current;
          let nextCaret = caret;
          for (const seg of pasteSegs) {
            const result = insertSegmentAtCaret(next, nextCaret, seg);
            next = result.segments;
            nextCaret = result.caret;
          }
          commitSegments(next, nextCaret);
        } catch {
          // fall through to default paste
        }
      },
      [commitSegments, onPaste],
    );

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

function mergeTextIntoPaste(segs: RichSegment[], chunk: string): void {
  const last = segs[segs.length - 1];
  if (last?.kind === "text") {
    last.value += chunk;
  } else {
    segs.push({ kind: "text", value: chunk });
  }
}
