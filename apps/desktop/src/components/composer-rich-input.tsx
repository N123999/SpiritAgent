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
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { caretToDomRange, selectionToCaret } from "@/lib/composer-segment-selection";
import {
  caretAtEnd,
  caretToPlainTextOffset,
  replaceWorkspaceFileReferenceInSegments,
  type ActiveWorkspaceFileReferenceQuery,
} from "@/lib/composer-segment-model";
import {
  domToSegments,
  emptySegments,
  ensureAgentModePinned,
  ensureLoopPinned,
  hasAgentModeSegment,
  hasLoopSegment,
  insertAgentModeSegment,
  insertLoopSegment,
  insertSegmentAtCaret,
  isAgentModeChipKind,
  isCaretAtAgentModeRemovalPoint,
  isCaretAtLoopRemovalPoint,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeComposerPlain,
  removeAgentModeSegment,
  removeLoopSegment,
  renderSegmentsToElement,
  segmentsEqual,
  segmentsToAttachments,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  type RichSegment,
  type SegmentCaret,
} from "@/lib/composer-segments";

export type { ActiveWorkspaceFileReferenceQuery } from "@/lib/composer-segment-model";
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
  loopEnabled?: boolean;
  loopChipLabel?: string;
  agentMode?: DesktopAgentMode;
  planChipLabel?: string;
  askChipLabel?: string;
  onTextChange(text: string): void;
  onElementAttachmentsChange(attachments: BrowserElementAttachment[]): void;
  onLoopEnabledChange?(enabled: boolean): void;
  onAgentModeChange?(mode: DesktopAgentMode): void;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  onPaste?(e: ClipboardEvent<HTMLDivElement>): void;
  /** UTF-16 offset in plain composer text (`segmentsToPlainText`), for @-file suggestions. */
  onSelectionChange?(selectionStart: number | null): void;
};

export type InsertLoopChipOptions = {
  /** Drop existing composer text; use after /loop or post-send reset. */
  clearText?: boolean;
};

export type InsertAgentModeChipOptions = InsertLoopChipOptions;

export type ComposerRichInputHandle = {
  focus(): void;
  insertAttachment(a: BrowserElementAttachment): void;
  insertWorkspaceFileReference(
    path: string,
    query: ActiveWorkspaceFileReferenceQuery,
    finalize?: boolean,
  ): void;
  insertLoopChip(options?: InsertLoopChipOptions): void;
  removeLoopChip(): void;
  insertPlanChip(options?: InsertAgentModeChipOptions): void;
  insertAskChip(options?: InsertAgentModeChipOptions): void;
  removeAgentModeChip(): void;
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
      loopEnabled = false,
      loopChipLabel = "Loop",
      agentMode = "agent",
      planChipLabel = "Plan",
      askChipLabel = "Ask",
      onTextChange,
      onElementAttachmentsChange,
      onLoopEnabledChange,
      onAgentModeChange,
      onKeyDown,
      onPaste,
      onSelectionChange,
    },
    ref,
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    const [segments, setSegments] = useState<RichSegment[]>(() => {
      const base = initialSegments?.length
        ? ensureLoopPinned(mergeAdjacentTextSegments([...initialSegments]))
        : loopEnabled
          ? insertLoopSegment(emptySegments()).segments
          : emptySegments();
      return ensureAgentModePinned(base, agentMode);
    });
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const isComposingRef = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const pendingCaretRef = useRef<SegmentCaret | null>(null);
    const skipExternalValueSyncRef = useRef(Boolean(initialSegments?.length));
    const skipRenderRef = useRef(false);
    const initialSegmentsHydratedRef = useRef(Boolean(initialSegments?.length));
    const onElementAttachmentsChangeRef = useRef(onElementAttachmentsChange);
    const onLoopEnabledChangeRef = useRef(onLoopEnabledChange);
    const onAgentModeChangeRef = useRef(onAgentModeChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const loopEnabledRef = useRef(loopEnabled);
    const agentModeRef = useRef(agentMode);
    const prevLoopEnabledRef = useRef(false);
    const prevAgentModeRef = useRef(agentMode);
    const hadLoopRef = useRef(hasLoopSegment(segments));
    const hadAgentModeRef = useRef(isAgentModeChipKind(agentMode));

    useEffect(() => {
      loopEnabledRef.current = loopEnabled;
    }, [loopEnabled]);

    useEffect(() => {
      agentModeRef.current = agentMode;
    }, [agentMode]);

    useEffect(() => {
      onLoopEnabledChangeRef.current = onLoopEnabledChange;
    }, [onLoopEnabledChange]);

    useEffect(() => {
      onAgentModeChangeRef.current = onAgentModeChange;
    }, [onAgentModeChange]);

    const syncLoopEnabledFromSegments = useCallback((next: RichSegment[]) => {
      const hasLoop = hasLoopSegment(next);
      if (hasLoop === hadLoopRef.current) {
        return;
      }
      // Loop is host-controlled while enabled; do not turn off from transient segment/DOM drift.
      if (!hasLoop && loopEnabledRef.current) {
        return;
      }
      hadLoopRef.current = hasLoop;
      onLoopEnabledChangeRef.current?.(hasLoop);
    }, []);

    const syncAgentModeFromSegments = useCallback((next: RichSegment[]) => {
      const mode = agentModeRef.current;
      const hasChip = hasAgentModeSegment(next);
      if (isAgentModeChipKind(mode)) {
        if (hasChip) {
          hadAgentModeRef.current = true;
          return;
        }
        if (hadAgentModeRef.current) {
          return;
        }
        return;
      }
      if (!hasChip && hadAgentModeRef.current) {
        hadAgentModeRef.current = false;
        onAgentModeChangeRef.current?.("agent");
      }
    }, []);

    const pinComposerSegments = useCallback(
      (next: RichSegment[], mode: DesktopAgentMode = agentModeRef.current): RichSegment[] =>
        ensureAgentModePinned(ensureLoopPinned(mergeAdjacentTextSegments(next)), mode),
      [],
    );

    const reportSelectionChange = useCallback(() => {
      const report = onSelectionChangeRef.current;
      if (!report) {
        return;
      }
      const div = divRef.current;
      if (!div) {
        report(null);
        return;
      }
      const caret = selectionToCaret(div, segmentsRef.current);
      if (!caret) {
        report(null);
        return;
      }
      report(caretToPlainTextOffset(segmentsRef.current, caret));
    }, []);

    useEffect(() => {
      const div = divRef.current;
      if (!div || !onSelectionChange) {
        return;
      }
      const report = () => reportSelectionChange();
      div.addEventListener("mouseup", report);
      div.addEventListener("keyup", report);
      document.addEventListener("selectionchange", report);
      return () => {
        div.removeEventListener("mouseup", report);
        div.removeEventListener("keyup", report);
        document.removeEventListener("selectionchange", report);
      };
    }, [onSelectionChange, reportSelectionChange]);

    useEffect(() => {
      onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);

    useEffect(() => {
      onElementAttachmentsChangeRef.current = onElementAttachmentsChange;
    });

    const notifyParents = useCallback(
      (next: RichSegment[]) => {
        skipExternalValueSyncRef.current = true;
        onTextChange(normalizeComposerPlain(segmentsToPlainText(next)));
        onElementAttachmentsChange(segmentsToAttachments(next));
      },
      [onTextChange, onElementAttachmentsChange],
    );

    const commitSegments = useCallback(
      (
        next: RichSegment[],
        caret?: SegmentCaret | null,
        options?: { notifyParent?: boolean; syncLoop?: boolean; syncAgentMode?: boolean },
      ) => {
        const merged = pinComposerSegments(next);
        segmentsRef.current = merged;
        pendingCaretRef.current = caret ?? null;
        setSegments(merged);
        if (options?.syncLoop !== false && !loopEnabledRef.current) {
          syncLoopEnabledFromSegments(merged);
        }
        if (options?.syncAgentMode !== false && !isAgentModeChipKind(agentModeRef.current)) {
          syncAgentModeFromSegments(merged);
        }
        if (options?.notifyParent !== false) {
          notifyParents(merged);
        }
      },
      [notifyParents, pinComposerSegments, syncAgentModeFromSegments, syncLoopEnabledFromSegments],
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

    const insertWorkspaceFileReference = useCallback(
      (path: string, query: ActiveWorkspaceFileReferenceQuery, finalize = true) => {
        const div = divRef.current;
        if (!div) {
          return;
        }
        div.focus();
        const { segments: next, caret } = replaceWorkspaceFileReferenceInSegments(
          segmentsRef.current,
          query,
          path,
          finalize,
        );
        commitSegments(next, caret);
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

    const insertLoopChip = useCallback(
      (options?: InsertLoopChipOptions) => {
        const div = divRef.current;
        if (div) {
          div.focus();
        }
        const base = options?.clearText ? emptySegments() : segmentsRef.current;
        if (!options?.clearText && hasLoopSegment(base)) {
          return;
        }
        const { segments: next, caret } = insertLoopSegment(base);
        if (options?.clearText) {
          loopEnabledRef.current = true;
        }
        hadLoopRef.current = true;
        commitSegments(next, caret, { syncLoop: false });
      },
      [commitSegments],
    );

    const removeLoopChip = useCallback(() => {
      if (!hasLoopSegment(segmentsRef.current)) {
        return;
      }
      const next = pinComposerSegments(removeLoopSegment(segmentsRef.current));
      hadLoopRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncLoop: false });
      onLoopEnabledChangeRef.current?.(false);
    }, [commitSegments, pinComposerSegments]);

    const insertAgentModeChip = useCallback(
      (mode: "plan" | "ask", options?: InsertAgentModeChipOptions) => {
        const div = divRef.current;
        if (div) {
          div.focus();
        }
        const base = options?.clearText ? emptySegments() : segmentsRef.current;
        const { segments: next, caret } = insertAgentModeSegment(base, mode);
        hadAgentModeRef.current = true;
        commitSegments(next, caret, { syncAgentMode: false });
      },
      [commitSegments],
    );

    const insertPlanChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("plan", options),
      [insertAgentModeChip],
    );

    const insertAskChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("ask", options),
      [insertAgentModeChip],
    );

    const removeAgentModeChip = useCallback(() => {
      if (!hasAgentModeSegment(segmentsRef.current)) {
        return;
      }
      const next = pinComposerSegments(removeAgentModeSegment(segmentsRef.current), "agent");
      hadAgentModeRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncAgentMode: false });
      onAgentModeChangeRef.current?.("agent");
    }, [commitSegments, pinComposerSegments]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => divRef.current?.focus(),
        insertAttachment,
        insertWorkspaceFileReference,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        removeAgentModeChip,
        getSegments,
        setSegments: (next: RichSegment[]) => applySegments(next),
      }),
      [
        insertAttachment,
        insertWorkspaceFileReference,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        removeAgentModeChip,
        getSegments,
        applySegments,
      ],
    );

    useEffect(() => {
      const prev = prevLoopEnabledRef.current;
      prevLoopEnabledRef.current = loopEnabled;
      if (!loopEnabled) {
        // Only strip chip when loop was on and is now turned off (not while host state is catching up).
        if (prev && hasLoopSegment(segmentsRef.current)) {
          removeLoopChip();
        }
        return;
      }
      if (!prev && !hasLoopSegment(segmentsRef.current)) {
        insertLoopChip();
      }
    }, [loopEnabled, insertLoopChip, removeLoopChip]);

    useEffect(() => {
      const prev = prevAgentModeRef.current;
      prevAgentModeRef.current = agentMode;
      if (!isAgentModeChipKind(agentMode)) {
        if (isAgentModeChipKind(prev) && hasAgentModeSegment(segmentsRef.current)) {
          removeAgentModeChip();
        }
        return;
      }
      if (prev !== agentMode || !hasAgentModeSegment(segmentsRef.current)) {
        insertAgentModeChip(agentMode, { clearText: false });
      }
    }, [agentMode, insertAgentModeChip, removeAgentModeChip]);

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
      if (!div || isComposingRef.current) {
        return;
      }

      const domSegs = domToSegments(div);
      if (skipRenderRef.current) {
        skipRenderRef.current = false;
        pendingCaretRef.current = null;
        reportSelectionChange();
        return;
      }

      if (segmentsEqual(domSegs, segments)) {
        if (pendingCaretRef.current) {
          caretToDomRange(div, segments, pendingCaretRef.current);
          pendingCaretRef.current = null;
          reportSelectionChange();
        }
        return;
      }

      renderSegmentsToElement(div, segments, {
        loopLabel: loopChipLabel,
        planLabel: planChipLabel,
        askLabel: askChipLabel,
      });
      if (pendingCaretRef.current) {
        caretToDomRange(div, segments, pendingCaretRef.current);
        pendingCaretRef.current = null;
        reportSelectionChange();
      }
    }, [segments, loopChipLabel, planChipLabel, askChipLabel, reportSelectionChange, value.length]);

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
      if (!value && attachmentCount === 0 && (plain || hasElements || hasLoopSegment(current) || hasAgentModeSegment(current))) {
        if (loopEnabled || loopEnabledRef.current) {
          const { segments: next, caret } = insertLoopSegment(emptySegments());
          commitSegments(
            ensureAgentModePinned(next, agentModeRef.current),
            caret,
            { syncLoop: false, syncAgentMode: false },
          );
          return;
        }
        if (isAgentModeChipKind(agentModeRef.current)) {
          const { segments: next, caret } = insertAgentModeSegment(emptySegments(), agentModeRef.current);
          commitSegments(next, caret, { syncLoop: false, syncAgentMode: false });
          return;
        }
        // Keep loop-only shell while host loopEnabled catches up (e.g. /loop).
        if (hasLoopSegment(current) && !plain && !hasElements) {
          return;
        }
        commitSegments(emptySegments(), { segmentIndex: 0, offset: 0 });
        return;
      }

      if (normalizeComposerPlain(plain) === normalizeComposerPlain(value)) {
        return;
      }

      const next = syncSegmentsFromExternalValue(current, value);
      if (!segmentsEqual(next, current)) {
        pendingCaretRef.current = null;
        segmentsRef.current = next;
        setSegments(next);
      }
    }, [value, elementAttachments?.length, initialSegments, applySegments, commitSegments, loopEnabled, agentMode]);

    const syncFromDom = useCallback(() => {
      const div = divRef.current;
      if (!div || isComposingRef.current) {
        return;
      }
      const caret = selectionToCaret(div, segmentsRef.current);
      let next = mergeAdjacentTextSegments(domToSegments(div));
      if (loopEnabledRef.current) {
        next = ensureLoopPinned(next);
        if (!hasLoopSegment(next)) {
          const { segments: pinned, caret: pinCaret } = insertLoopSegment(next);
          commitSegments(
            ensureAgentModePinned(pinned, agentModeRef.current),
            caret ?? pinCaret,
            { syncLoop: false, syncAgentMode: false },
          );
          reportSelectionChange();
          return;
        }
        if (isAgentModeChipKind(agentModeRef.current)) {
          next = ensureAgentModePinned(next, agentModeRef.current);
        }
        skipRenderRef.current = true;
        pendingCaretRef.current = caret;
        segmentsRef.current = next;
        hadLoopRef.current = true;
        if (hasAgentModeSegment(next)) {
          hadAgentModeRef.current = true;
        }
        setSegments(next);
        notifyParents(next);
        reportSelectionChange();
        return;
      }
      if (isAgentModeChipKind(agentModeRef.current)) {
        next = ensureAgentModePinned(next, agentModeRef.current);
        if (!hasAgentModeSegment(next)) {
          const { segments: pinned, caret: pinCaret } = insertAgentModeSegment(next, agentModeRef.current);
          commitSegments(pinned, caret ?? pinCaret, { syncLoop: false, syncAgentMode: false });
          reportSelectionChange();
          return;
        }
        skipRenderRef.current = true;
        pendingCaretRef.current = caret;
        segmentsRef.current = next;
        hadAgentModeRef.current = true;
        setSegments(next);
        notifyParents(next);
        reportSelectionChange();
        return;
      }
      skipRenderRef.current = true;
      next = pinComposerSegments(next);
      pendingCaretRef.current = caret;
      segmentsRef.current = next;
      setSegments(next);
      syncLoopEnabledFromSegments(next);
      syncAgentModeFromSegments(next);
      notifyParents(next);
      reportSelectionChange();
    }, [
      commitSegments,
      notifyParents,
      pinComposerSegments,
      reportSelectionChange,
      syncAgentModeFromSegments,
      syncLoopEnabledFromSegments,
    ]);

    const handleInput = useCallback(() => {
      syncFromDom();
    }, [syncFromDom]);

    const handleCompositionStart = useCallback(() => {
      isComposingRef.current = true;
      setIsComposing(true);
    }, []);

    const handleCompositionEnd = useCallback(() => {
      isComposingRef.current = false;
      setIsComposing(false);
      syncFromDom();
    }, [syncFromDom]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Backspace" && !e.defaultPrevented) {
          const div = divRef.current;
          if (div) {
            const caret = selectionToCaret(div, segmentsRef.current);
            if (caret && isCaretAtLoopRemovalPoint(segmentsRef.current, caret)) {
              e.preventDefault();
              removeLoopChip();
              return;
            }
            if (caret && isCaretAtAgentModeRemovalPoint(segmentsRef.current, caret)) {
              e.preventDefault();
              removeAgentModeChip();
              return;
            }
          }
        }
        onKeyDown?.(e);
      },
      [onKeyDown, removeLoopChip, removeAgentModeChip],
    );

    const handleKeyUp = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if ((e.key === "Backspace" || e.key === "Delete") && !e.defaultPrevented) {
          syncFromDom();
        }
      },
      [syncFromDom],
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

    const plainForEmptyCheck = segmentsToPlainText(segments);
    const isEmpty =
      !isComposing &&
      isComposerPlainEmpty(plainForEmptyCheck) &&
      !(elementAttachments?.length) &&
      !hasLoopSegment(segments) &&
      !hasAgentModeSegment(segments);

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
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
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
