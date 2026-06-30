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
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import { hasInlineAttachmentChipSegments } from "@/lib/composer-inline-chip-dom";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { caretToDomRange, selectionToCaret } from "@/lib/composer-segment-selection";
import {
  caretAtEnd,
  caretToPlainTextOffset,
  plainTextOffsetToCaret,
  replaceSkillSlashQueryInSegments,
  replaceWorkspaceFileReferenceInSegments,
  normalizeWorkspaceFilePath,
  type ActiveSkillSlashQuery,
  type ActiveWorkspaceFileReferenceQuery,
} from "@/lib/composer-segment-model";
import {
  applyAgentModeChipPolicy,
  buildSegmentsAfterSend,
  composerShowsPlaceholder,
  domParsedMissingRequiredAgentChip,
  shouldPinAgentModeChip,
  synchronizeTextFromDom,
  type AgentModeChipPolicy,
} from "@/lib/composer-agent-mode-policy";
import type { AgentModeChipKind } from "@/lib/composer-agent-mode-segments";
import {
  domToSegments,
  composerDomStructureMatchesSegments,
  emptySegments,
  caretAfterAgentModeChip,
  ensureLoopChipTypingTail,
  ensureLoopPinned,
  hasAgentModeSegment,
  hasLoopSegment,
  hasSkillSegment,
  insertAgentModeSegment,
  insertLoopSegment,
  insertSegmentAtCaret,
  isAgentModeChipKind,
  isCaretAtAgentModeRemovalPoint,
  isCaretAtInlineChipRemovalPoint,
  isCaretAtLoopRemovalPoint,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeCaretForComposer,
  normalizeComposerPlain,
  removeInlineChipAtRemovalPoint,
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
  /** Rich segments committed locally; plain text / cursor may be unchanged. */
  onSegmentsCommit?(): void;
  onLoopEnabledChange?(enabled: boolean): void;
  onAgentModeChange?(mode: DesktopAgentMode): void;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  onPaste?(e: ClipboardEvent<HTMLDivElement>): void;
  /** UTF-16 offset in plain composer text (`segmentsToPlainText`), for @-file suggestions. */
  onSelectionChange?(selectionStart: number | null): void;
  /** Agent 正在输出时，阻止父级滞后 value 覆盖本地 segments（poll 重渲染）。 */
  conversationBusy?: boolean;
  /** Session 级：用户 Backspace 去掉 Plan/Ask chip 后，poll 不得再通过 DOM 钉回。 */
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
};

export type InsertLoopChipOptions = {
  /** Drop existing composer text; use after /loop or post-send reset. */
  clearText?: boolean;
};

export type InsertAgentModeChipOptions = InsertLoopChipOptions;

export type InsertSkillChipOptions = {
  /** Drop existing composer text; use when prefilling from settings or similar. */
  clearText?: boolean;
  /** Append a trailing space after the chip for natural-language follow-up. */
  appendTrailingSpace?: boolean;
};

export type ComposerRichInputHandle = {
  focus(): void;
  focusAtEnd(): void;
  insertAttachment(a: BrowserElementAttachment): void;
  insertPrDiffAttachment(attachment: PrDiffAttachment): void;
  insertGitCommitAttachment(attachment: GitCommitAttachment): void;
  insertTerminalSnippet(attachment: TerminalSnippetAttachment): void;
  insertFileSnippet(attachment: FileSnippetAttachment): void;
  insertWorkspaceFileReference(
    path: string,
    query: ActiveWorkspaceFileReferenceQuery,
    finalize?: boolean,
  ): void;
  insertWorkspaceFileAtCaret(path: string): void;
  insertLoopChip(options?: InsertLoopChipOptions): void;
  removeLoopChip(): void;
  insertPlanChip(options?: InsertAgentModeChipOptions): void;
  insertAskChip(options?: InsertAgentModeChipOptions): void;
  insertDebugChip(options?: InsertAgentModeChipOptions): void;
  removeAgentModeChip(): void;
  insertSkillChip(alias: string, options?: InsertSkillChipOptions): void;
  replaceSkillSlashQuery(
    query: ActiveSkillSlashQuery,
    replacement: string,
    finalize?: boolean,
  ): void;
  removeSkillSlashQuery(query: ActiveSkillSlashQuery): void;
  insertPlainTextAtCaret(text: string): void;
  /** 发送成功后由宿主调用：恢复 chip（若仍为 plan/ask）并将光标置于 chip 后。 */
  resetAfterSend(agentMode: DesktopAgentMode): void;
  getSegments(): RichSegment[];
  setSegments(segments: RichSegment[]): void;
  getPlainTextCaretClientRect(plainTextOffset: number): DOMRect | null;
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
      onSegmentsCommit,
      onLoopEnabledChange,
      onAgentModeChange,
      onKeyDown,
      onPaste,
      onSelectionChange,
      conversationBusy = false,
      agentModeChipDismissed = false,
      onAgentModeChipDismissChange,
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
      return applyAgentModeChipPolicy(base, { hostMode: agentMode, dismissed: false });
    });
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const isComposingRef = useRef(false);
    const [isComposing, setIsComposing] = useState(false);
    const pendingCaretRef = useRef<SegmentCaret | null>(null);
    const skipExternalValueSyncRef = useRef(Boolean(initialSegments?.length));
    /** 最近一次 notifyParents 上报给父级的纯文本，用于识别 poll 时滞后的 value。 */
    const lastSyncedToParentPlainRef = useRef<string | null>(null);
    const conversationBusyRef = useRef(conversationBusy);
    const skipRenderRef = useRef(false);
    const initialSegmentsHydratedRef = useRef(Boolean(initialSegments?.length));
    const onElementAttachmentsChangeRef = useRef(onElementAttachmentsChange);
    const onLoopEnabledChangeRef = useRef(onLoopEnabledChange);
    const onAgentModeChangeRef = useRef(onAgentModeChange);
    const onSegmentsCommitRef = useRef(onSegmentsCommit);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const loopEnabledRef = useRef(loopEnabled);
    const agentModeRef = useRef(agentMode);
    const prevLoopEnabledRef = useRef(false);
    const prevAgentModeRef = useRef(agentMode);
    const hadLoopRef = useRef(hasLoopSegment(segments));
    const hadAgentModeRef = useRef(isAgentModeChipKind(agentMode));
    const agentModeChipDismissedRef = useRef(agentModeChipDismissed);
    const onAgentModeChipDismissChangeRef = useRef(onAgentModeChipDismissChange);

    useEffect(() => {
      agentModeChipDismissedRef.current = agentModeChipDismissed;
    }, [agentModeChipDismissed]);

    useEffect(() => {
      onAgentModeChipDismissChangeRef.current = onAgentModeChipDismissChange;
    }, [onAgentModeChipDismissChange]);

    useEffect(() => {
      loopEnabledRef.current = loopEnabled;
    }, [loopEnabled]);

    useEffect(() => {
      agentModeRef.current = agentMode;
    }, [agentMode]);

    useEffect(() => {
      conversationBusyRef.current = conversationBusy;
    }, [conversationBusy]);

    useEffect(() => {
      onLoopEnabledChangeRef.current = onLoopEnabledChange;
    }, [onLoopEnabledChange]);

    useEffect(() => {
      onAgentModeChangeRef.current = onAgentModeChange;
    }, [onAgentModeChange]);

    useEffect(() => {
      onSegmentsCommitRef.current = onSegmentsCommit;
    }, [onSegmentsCommit]);

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
        hadAgentModeRef.current = false;
        onAgentModeChangeRef.current?.("agent");
        return;
      }
      if (!hasChip && hadAgentModeRef.current) {
        hadAgentModeRef.current = false;
        onAgentModeChangeRef.current?.("agent");
      }
    }, []);

    const chipPolicy = useCallback((): AgentModeChipPolicy => {
      return {
        hostMode: agentModeRef.current,
        dismissed: agentModeChipDismissedRef.current,
      };
    }, []);

    const applyComposerPolicy = useCallback(
      (next: RichSegment[]): RichSegment[] =>
        applyAgentModeChipPolicy(
          ensureLoopChipTypingTail(ensureLoopPinned(mergeAdjacentTextSegments(next))),
          chipPolicy(),
        ),
      [chipPolicy],
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
        const plain = normalizeComposerPlain(segmentsToPlainText(next));
        lastSyncedToParentPlainRef.current = plain;
        skipExternalValueSyncRef.current = true;
        onTextChange(plain);
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
        const merged = applyComposerPolicy(next);
        let resolvedCaret = caret ?? null;
        if (
          hasLoopSegment(merged)
          || (shouldPinAgentModeChip(chipPolicy()) && hasAgentModeSegment(merged))
        ) {
          resolvedCaret = normalizeCaretForComposer(merged, resolvedCaret);
        }
        segmentsRef.current = merged;
        pendingCaretRef.current = resolvedCaret;
        setSegments(merged);
        onSegmentsCommitRef.current?.();
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
      [applyComposerPolicy, chipPolicy, notifyParents, syncAgentModeFromSegments, syncLoopEnabledFromSegments],
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

    const insertPrDiffAttachment = useCallback(
      (attachment: PrDiffAttachment) => {
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
          kind: "prDiff",
          attachment,
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const insertGitCommitAttachment = useCallback(
      (attachment: GitCommitAttachment) => {
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
          kind: "gitCommit",
          attachment,
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const insertTerminalSnippet = useCallback(
      (attachment: TerminalSnippetAttachment) => {
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
          kind: "terminalSnippet",
          attachment,
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const insertFileSnippet = useCallback(
      (attachment: FileSnippetAttachment) => {
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
          kind: "fileSnippet",
          attachment,
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

    const insertWorkspaceFileAtCaret = useCallback(
      (path: string) => {
        const div = divRef.current;
        if (!div) {
          return;
        }
        div.focus();
        const current = segmentsRef.current;
        const caret =
          selectionToCaret(div, current) ?? {
            segmentIndex: current.length - 1,
            offset: segmentsToPlainText(current).length,
          };
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, {
          kind: "workspaceFile",
          path: normalizeWorkspaceFilePath(path),
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const replaceSkillSlashQuery = useCallback(
      (query: ActiveSkillSlashQuery, replacement: string, finalize = false) => {
        const div = divRef.current;
        if (!div) {
          return;
        }
        div.focus();
        const { segments: next, caret } = replaceSkillSlashQueryInSegments(
          segmentsRef.current,
          query,
          replacement,
          finalize,
        );
        commitSegments(next, caret);
      },
      [commitSegments],
    );

    const removeSkillSlashQuery = useCallback(
      (query: ActiveSkillSlashQuery) => {
        replaceSkillSlashQuery(query, "", false);
      },
      [replaceSkillSlashQuery],
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
      const next = applyComposerPolicy(removeLoopSegment(segmentsRef.current));
      loopEnabledRef.current = false;
      hadLoopRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncLoop: false });
      onLoopEnabledChangeRef.current?.(false);
    }, [applyComposerPolicy, commitSegments]);

    const insertAgentModeChip = useCallback(
      (mode: AgentModeChipKind, options?: InsertAgentModeChipOptions) => {
        const div = divRef.current;
        if (div) {
          div.focus();
        }
        const base = options?.clearText ? emptySegments() : segmentsRef.current;
        agentModeChipDismissedRef.current = false;
        onAgentModeChipDismissChangeRef.current?.(false);
        const { segments: next, caret } = insertAgentModeSegment(base, mode);
        // Pin policy to the mode being inserted; host agentMode prop may lag saveSettingsPatch / poll.
        agentModeRef.current = mode;
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

    const insertDebugChip = useCallback(
      (options?: InsertAgentModeChipOptions) => insertAgentModeChip("debug", options),
      [insertAgentModeChip],
    );

    const insertPlainTextAtCaret = useCallback(
      (text: string) => {
        if (!text) {
          return;
        }
        const div = divRef.current;
        if (!div) {
          return;
        }
        div.focus();
        const current = mergeAdjacentTextSegments(segmentsRef.current);
        const caret = selectionToCaret(div, current) ?? caretAtEnd(current);
        const seg = current[caret.segmentIndex];
        if (seg?.kind === "text") {
          const before = seg.value.slice(0, caret.offset);
          const after = seg.value.slice(caret.offset);
          const next = mergeAdjacentTextSegments([
            ...current.slice(0, caret.segmentIndex),
            { kind: "text" as const, value: `${before}${text}${after}` },
            ...current.slice(caret.segmentIndex + 1),
          ]);
          commitSegments(next, {
            segmentIndex: caret.segmentIndex,
            offset: caret.offset + text.length,
          });
          return;
        }
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(current, caret, {
          kind: "text",
          value: text,
        });
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const insertSkillChip = useCallback(
      (alias: string, options?: InsertSkillChipOptions) => {
        const div = divRef.current;
        if (!div) {
          return;
        }
        div.focus();
        const base = options?.clearText
          ? emptySegments()
          : mergeAdjacentTextSegments(segmentsRef.current);
        const caret = options?.clearText
          ? caretAtEnd(base)
          : (selectionToCaret(div, base) ?? caretAtEnd(base));
        let { segments: next, caret: nextCaret } = insertSegmentAtCaret(base, caret, {
          kind: "skill",
          alias,
        });
        if (options?.appendTrailingSpace) {
          const trailing = next[nextCaret.segmentIndex];
          const chipTailAlreadySpaced =
            trailing?.kind === "text" &&
            isComposerPlainEmpty(trailing.value) &&
            nextCaret.offset > 0;
          if (!chipTailAlreadySpaced) {
            ({ segments: next, caret: nextCaret } = insertSegmentAtCaret(next, nextCaret, {
              kind: "text",
              value: " ",
            }));
          }
        }
        commitSegments(next, nextCaret);
      },
      [commitSegments],
    );

    const removeAgentModeChip = useCallback(() => {
      if (!hasAgentModeSegment(segmentsRef.current)) {
        return;
      }
      agentModeChipDismissedRef.current = true;
      onAgentModeChipDismissChangeRef.current?.(true);
      const next = applyAgentModeChipPolicy(removeAgentModeSegment(segmentsRef.current), {
        hostMode: agentModeRef.current,
        dismissed: true,
      });
      hadAgentModeRef.current = false;
      commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncAgentMode: false });
      if (isAgentModeChipKind(agentModeRef.current)) {
        onAgentModeChangeRef.current?.("agent");
      }
    }, [commitSegments]);

    const resetAfterSend = useCallback(
      (mode: DesktopAgentMode) => {
        agentModeChipDismissedRef.current = false;
        onAgentModeChipDismissChangeRef.current?.(false);
        let next = buildSegmentsAfterSend(mode);
        if (loopEnabledRef.current) {
          next = insertLoopSegment(next).segments;
        }
        const caret = hasAgentModeSegment(next)
          ? caretAfterAgentModeChip(next)
          : caretAtEnd(next);
        skipExternalValueSyncRef.current = true;
        commitSegments(next, caret, { syncLoop: false, syncAgentMode: false });
      },
      [commitSegments],
    );

    const focusAtEnd = useCallback(() => {
      const div = divRef.current;
      if (!div) {
        return;
      }
      const segments = segmentsRef.current;
      div.focus();
      const caret = normalizeCaretForComposer(segments, caretAtEnd(segments));
      caretToDomRange(div, segments, caret);
      reportSelectionChange();
    }, [reportSelectionChange]);

    const getPlainTextCaretClientRect = useCallback((plainTextOffset: number): DOMRect | null => {
      const root = divRef.current;
      if (!root) {
        return null;
      }

      const segments = segmentsRef.current;
      const caret = plainTextOffsetToCaret(segments, plainTextOffset);
      const selection = window.getSelection();
      const savedRanges: Range[] = [];
      if (selection) {
        for (let index = 0; index < selection.rangeCount; index += 1) {
          savedRanges.push(selection.getRangeAt(index).cloneRange());
        }
      }

      caretToDomRange(root, segments, caret);

      let rect: DOMRect | null = null;
      if (selection && selection.rangeCount > 0) {
        rect = selection.getRangeAt(0).getBoundingClientRect();
      }

      selection?.removeAllRanges();
      for (const range of savedRanges) {
        selection?.addRange(range);
      }

      return rect;
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => divRef.current?.focus(),
        focusAtEnd,
        insertAttachment,
        insertPrDiffAttachment,
        insertGitCommitAttachment,
        insertTerminalSnippet,
        insertFileSnippet,
        insertWorkspaceFileReference,
        insertWorkspaceFileAtCaret,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        insertDebugChip,
        removeAgentModeChip,
        insertSkillChip,
        replaceSkillSlashQuery,
        removeSkillSlashQuery,
        insertPlainTextAtCaret,
        resetAfterSend,
        getSegments,
        setSegments: (next: RichSegment[]) => applySegments(next),
        getPlainTextCaretClientRect,
      }),
      [
        insertAttachment,
        insertPrDiffAttachment,
        insertGitCommitAttachment,
        insertTerminalSnippet,
        insertFileSnippet,
        insertWorkspaceFileReference,
        insertWorkspaceFileAtCaret,
        replaceSkillSlashQuery,
        removeSkillSlashQuery,
        insertPlainTextAtCaret,
        insertLoopChip,
        removeLoopChip,
        insertPlanChip,
        insertAskChip,
        insertDebugChip,
        removeAgentModeChip,
        insertSkillChip,
        resetAfterSend,
        focusAtEnd,
        getSegments,
        getPlainTextCaretClientRect,
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
      if (prev !== agentMode && !agentModeChipDismissedRef.current) {
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

      const domEqual = composerDomStructureMatchesSegments(div, segments);

      if (skipRenderRef.current) {
        skipRenderRef.current = false;
        if (!domEqual) {
          renderSegmentsToElement(div, segments, {
            loopLabel: loopChipLabel,
            planLabel: planChipLabel,
            askLabel: askChipLabel,
          });
        }
        if (pendingCaretRef.current) {
          const caret = normalizeCaretForComposer(segments, pendingCaretRef.current);
          caretToDomRange(div, segments, caret);
          pendingCaretRef.current = null;
        }
        reportSelectionChange();
        return;
      }

      if (domEqual) {
        if (pendingCaretRef.current) {
          const caret = normalizeCaretForComposer(segments, pendingCaretRef.current);
          caretToDomRange(div, segments, caret);
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
        const caret = normalizeCaretForComposer(segments, pendingCaretRef.current);
        caretToDomRange(div, segments, caret);
        pendingCaretRef.current = null;
        reportSelectionChange();
      } else if (
        hasLoopSegment(segments) &&
        isComposerPlainEmpty(segmentsToPlainText(segments))
      ) {
        const caret = normalizeCaretForComposer(segments, selectionToCaret(div, segments));
        caretToDomRange(div, segments, caret);
        reportSelectionChange();
      } else if (
        shouldPinAgentModeChip(chipPolicy()) &&
        hasAgentModeSegment(segments) &&
        isComposerPlainEmpty(segmentsToPlainText(segments))
      ) {
        const caret = normalizeCaretForComposer(segments, selectionToCaret(div, segments));
        caretToDomRange(div, segments, caret);
        reportSelectionChange();
      }
    }, [chipPolicy, segments, loopChipLabel, planChipLabel, askChipLabel, reportSelectionChange, value.length]);

    useEffect(() => {
      const current = segmentsRef.current;
      const plain = segmentsToPlainText(current);
      const localPlain = normalizeComposerPlain(plain);
      const externalPlain = normalizeComposerPlain(value);
      if (skipExternalValueSyncRef.current) {
        const expected = lastSyncedToParentPlainRef.current;
        if (expected !== null && externalPlain !== expected) {
          skipExternalValueSyncRef.current = true;
          return;
        }
        skipExternalValueSyncRef.current = false;
        return;
      }

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

      // Parent cleared composer after send: 由 resetAfterSend 恢复 chip；此处仅处理 loop shell。
      if (!value && attachmentCount === 0 && (plain || hasElements || hasLoopSegment(current) || hasAgentModeSegment(current))) {
        if (hasLoopSegment(current) && isComposerPlainEmpty(plain) && !hasElements) {
          return;
        }
        if ((loopEnabled || loopEnabledRef.current) && !hasLoopSegment(current)) {
          const { segments: next, caret } = insertLoopSegment(emptySegments());
          commitSegments(applyComposerPolicy(next), caret, { syncLoop: false, syncAgentMode: false });
          return;
        }
        // 发消息后 resetAfterSend 已恢复 chip；busy poll 时勿反复 empty→policy 重插（日志 B 根因）。
        const policy = chipPolicy();
        if (
          shouldPinAgentModeChip(policy) &&
          hasAgentModeSegment(current) &&
          isComposerPlainEmpty(plain) &&
          !hasElements
        ) {
          return;
        }
        if (agentModeChipDismissedRef.current && !hasAgentModeSegment(current)) {
          return;
        }
        // Skill chip 存在时，parent 侧 value 为空（segmentsToPlainText 对 skill 返回 ""），
        // 但 chip 本身应保留，勿清空。
        if (hasSkillSegment(current) && isComposerPlainEmpty(plain)) {
          return;
        }
        // PR diff / 工作区文件 / 元素 chip 不贡献 parent plain；parent value 为空时保留内联 chip。
        if (hasInlineAttachmentChipSegments(current) && isComposerPlainEmpty(plain)) {
          return;
        }
        commitSegments(emptySegments(), { segmentIndex: 0, offset: 0 });
        return;
      }

      if (localPlain === externalPlain) {
        return;
      }

      if (
        conversationBusyRef.current &&
        lastSyncedToParentPlainRef.current === localPlain &&
        externalPlain !== localPlain
      ) {
        return;
      }

      let next = syncSegmentsFromExternalValue(current, value);
      next = applyComposerPolicy(next);
      if (agentModeChipDismissedRef.current && hasAgentModeSegment(next)) {
        next = removeAgentModeSegment(next);
      }
      if (!segmentsEqual(next, current)) {
        const nextCaret = normalizeCaretForComposer(next, caretAtEnd(next));
        // 勿设 skipRenderRef：DOM 仍为旧正文时跳过 render 会导致斜杠替换只留在 React state、界面仍显示 "/"。
        commitSegments(next, nextCaret, {
          notifyParent: false,
          syncLoop: false,
          syncAgentMode: false,
        });
      }
    }, [
      value,
      elementAttachments?.length,
      initialSegments,
      applyComposerPolicy,
      applySegments,
      commitSegments,
      loopEnabled,
      agentMode,
      agentModeChipDismissed,
      conversationBusy,
    ]);

    /**
     * DOM 只上报正文/附件；plan/ask/loop 以 segments 为准。
     * DOM 暂时缺 chip 时只 forceRenderFromSegments，不改 segments、不降级 agentMode。
     */
    const syncFromDom = useCallback(() => {
      const div = divRef.current;
      if (!div || isComposingRef.current) {
        return;
      }

      const shell = segmentsRef.current;
      const domParsed = mergeAdjacentTextSegments(domToSegments(div));
      const policy = chipPolicy();
      const domPlain = segmentsToPlainText(domParsed);

      if (domParsedMissingRequiredAgentChip(shell, domParsed, policy)) {
        if (isComposerPlainEmpty(domPlain)) {
          agentModeChipDismissedRef.current = true;
          onAgentModeChipDismissChangeRef.current?.(true);
          const next = removeAgentModeSegment(domParsed);
          hadAgentModeRef.current = false;
          commitSegments(next, { segmentIndex: 0, offset: 0 }, { syncAgentMode: false });
          if (isAgentModeChipKind(agentModeRef.current)) {
            onAgentModeChangeRef.current?.("agent");
          }
          reportSelectionChange();
          return;
        }
        skipRenderRef.current = false;
        pendingCaretRef.current = normalizeCaretForComposer(
          shell,
          selectionToCaret(div, shell),
        );
        setSegments(shell);
        reportSelectionChange();
        return;
      }

      let caret = selectionToCaret(div, domParsed);
      let next = synchronizeTextFromDom(shell, domParsed);
      next = applyComposerPolicy(next);

      if (loopEnabledRef.current) {
        next = ensureLoopPinned(next);
        if (!hasLoopSegment(next)) {
          const { segments: pinned, caret: pinCaret } = insertLoopSegment(next);
          commitSegments(applyComposerPolicy(pinned), caret ?? pinCaret, {
            syncLoop: false,
            syncAgentMode: false,
          });
          reportSelectionChange();
          return;
        }
      }

      caret = normalizeCaretForComposer(next, caret);

      skipRenderRef.current = true;
      pendingCaretRef.current = caret;
      segmentsRef.current = next;
      hadLoopRef.current = hasLoopSegment(next);
      hadAgentModeRef.current = hasAgentModeSegment(next);
      setSegments(next);
      if (!loopEnabledRef.current) {
        syncLoopEnabledFromSegments(next);
      }
      if (!isAgentModeChipKind(agentModeRef.current)) {
        syncAgentModeFromSegments(next);
      }
      notifyParents(next);
      reportSelectionChange();
    }, [
      applyComposerPolicy,
      chipPolicy,
      commitSegments,
      notifyParents,
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

    const restoreNormalizedCaret = useCallback(() => {
      const div = divRef.current;
      if (!div) {
        return;
      }
      const raw = selectionToCaret(div, segmentsRef.current);
      if (!raw) {
        return;
      }
      const caret = normalizeCaretForComposer(segmentsRef.current, raw);
      if (
        caret.segmentIndex === raw.segmentIndex &&
        caret.offset === raw.offset
      ) {
        return;
      }
      pendingCaretRef.current = caret;
      skipRenderRef.current = true;
      caretToDomRange(div, segmentsRef.current, caret);
      reportSelectionChange();
    }, [reportSelectionChange]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Backspace" && !e.defaultPrevented) {
          const div = divRef.current;
          if (div) {
            const rawCaret = selectionToCaret(div, segmentsRef.current);
            const caret = rawCaret
              ? normalizeCaretForComposer(segmentsRef.current, rawCaret)
              : null;
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
            if (caret && isCaretAtInlineChipRemovalPoint(segmentsRef.current, caret)) {
              const removed = removeInlineChipAtRemovalPoint(segmentsRef.current, caret);
              if (removed) {
                e.preventDefault();
                commitSegments(removed.segments, removed.caret);
                return;
              }
            }
          }
        }
        onKeyDown?.(e);
      },
      [commitSegments, onKeyDown, removeLoopChip, removeAgentModeChip],
    );

    const handleKeyUp = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          !e.defaultPrevented
        ) {
          syncFromDom();
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          restoreNormalizedCaret();
        }
      },
      [restoreNormalizedCaret, syncFromDom],
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
        if (raw) {
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
            // fall through to plain-text paste below
          }
          return;
        }

        const plain = e.nativeEvent.clipboardData?.getData("text/plain");
        if (!plain) return;
        e.preventDefault();
        const div = divRef.current;
        if (!div) return;
        const caret =
          selectionToCaret(div, segmentsRef.current) ?? caretAtEnd(segmentsRef.current);
        const { segments: next, caret: nextCaret } = insertSegmentAtCaret(
          segmentsRef.current,
          caret,
          { kind: "text", value: plain },
        );
        commitSegments(next, nextCaret);
      },
      [commitSegments, onPaste],
    );

    const isEmpty = composerShowsPlaceholder(segments, {
      composing: isComposing,
      attachmentCount: elementAttachments?.length ?? 0,
    });

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
