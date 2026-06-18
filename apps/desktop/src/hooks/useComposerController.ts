import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { TFunction } from "i18next";

import {
  currentWorkspaceFileReferenceQuery,
  codeUnitIndexToCharCount,
} from "@spirit-agent/host-internal/workspace-file-reference-query";

import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { segmentsToMessageText } from "@/components/composer-rich-input";
import { cycleAgentMode, type DesktopAgentMode } from "@/lib/agent-mode";
import {
  resolveComposerDirectMediaTool,
} from "@/lib/composer-direct-media";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import type { PrDiffAttachment } from "@/lib/pr-diff-attachment";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";
import type { FileSnippetAttachment } from "@/lib/file-snippet-attachment";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import { useWorkspaceFileIndex } from "@/hooks/use-workspace-file-index";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import {
  appendComposerLocalFileAttachment,
  removeComposerLocalFileAttachment,
} from "@/lib/local-file-attachments";
import {
  isNewSessionAction,
  type ActionPaletteItem,
} from "@/lib/action-palette";
import {
  buildSkillSlashSuggestions,
  currentSkillSlashQueryAtCursor,
  FORK_SLASH_ALIAS,
  skillSlashAlias,
  skillSlashQueryKey,
  type SkillSlashSuggestion,
} from "@/lib/skill-slash";
import { canForkSession } from "@/lib/fork-eligibility";
import { findLastForkableAssistantMessageId } from "@/lib/fork-session-utils";
import { shouldPromptGitBranchCheckoutBeforeSend } from "@/lib/composer-branch-checkout-gate";
import type {
  DesktopSnapshot,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type UseComposerControllerOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  t: TFunction;
  isEmptySession: boolean;
  activeSessionReadOnly: boolean;
  compactionDemoActive: boolean;
  subagentViewActive: boolean;
  pendingApproval: DesktopSnapshot["conversation"]["pendingToolApproval"];
  pendingQuestions: ReturnType<typeof useDesktopRuntime>["pendingQuestions"];
  conversationInterruptible: boolean;
  handleNewSession: () => void;
  setActiveSurface: (
    surface: "conversation" | "settings" | "marketplace" | "automations" | "automation-detail",
  ) => void;
  setLastNonSettingsSurface: (surface: "conversation" | "marketplace" | "automations") => void;
};

export function useComposerController({
  runtime,
  snapshot,
  t,
  isEmptySession,
  activeSessionReadOnly,
  compactionDemoActive,
  subagentViewActive,
  pendingApproval,
  pendingQuestions,
  conversationInterruptible,
  handleNewSession,
  setActiveSurface,
  setLastNonSettingsSurface,
}: UseComposerControllerOptions) {
  const [composerBrowserElementAttachments, setComposerBrowserElementAttachments] = useState<
    BrowserElementAttachment[]
  >([]);
  const [composerCursorCodeUnits, setComposerCursorCodeUnits] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1);
  const [fileReferenceSuggestions, setFileReferenceSuggestions] =
    useState<WorkspaceFileReferenceSuggestionsResponse>(null);
  const [fileReferenceSelectedIndex, setFileReferenceSelectedIndex] = useState(-1);
  const [dismissedFileReferenceKey, setDismissedFileReferenceKey] = useState<string | null>(null);
  const [dismissedSlashQueryKey, setDismissedSlashQueryKey] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [actionPickerOpen, setActionPickerOpen] = useState(false);
  const [branchCheckoutDialogOpen, setBranchCheckoutDialogOpen] = useState(false);
  const [branchCheckoutBlockedByChanges, setBranchCheckoutBlockedByChanges] = useState(false);
  const pendingComposerSendRef = useRef<{
    text: string;
    localFilePaths?: string[];
  } | null>(null);
  const composerRichInputRef = useRef<ComposerRichInputHandle | null>(null);

  useLocalFileAttachmentPreviews(
    runtime.composerLocalFileAttachments,
    runtime.setComposerLocalFileAttachments,
    runtime.readLocalImagePreviewDataUrl,
  );

  const composerDirectMediaMode = useMemo(() => {
    if (!snapshot?.config) {
      return null;
    }
    return resolveComposerDirectMediaTool(snapshot.config.activeModel, snapshot.config);
  }, [snapshot?.config]);

  const composerPlaceholder = activeSessionReadOnly
    ? t("app.readOnlySession")
    : composerDirectMediaMode === "generate_image"
      ? t("composer.placeholderGenerateImage")
      : composerDirectMediaMode === "generate_video"
        ? t("composer.placeholderGenerateVideo")
        : t("app.typeMessage");

  const messageRewindComposerEnabled =
    !compactionDemoActive &&
    !subagentViewActive &&
    !activeSessionReadOnly &&
    !pendingApproval &&
    !pendingQuestions &&
    runtime.busyAction !== "rewind" &&
    runtime.busyAction !== "session";

  const composerHasPayload =
    Boolean(runtime.composer.trim()) || runtime.composerLocalFileAttachments.length > 0;

  const composerCanSend =
    !compactionDemoActive &&
    !subagentViewActive &&
    composerHasPayload &&
    !activeSessionReadOnly &&
    runtime.busyAction !== "session" &&
    !pendingApproval &&
    !pendingQuestions &&
    (runtime.summary.canSend || conversationInterruptible) &&
    !(runtime.busyAction === "send" && !conversationInterruptible);

  const commitBusy = runtime.busyAction === "git";
  const gitChipBusy =
    runtime.busyAction === "send" || snapshot?.conversation.isBusy === true;

  const composerCursorChars = useMemo(
    () => codeUnitIndexToCharCount(runtime.composer, composerCursorCodeUnits),
    [composerCursorCodeUnits, runtime.composer],
  );

  const slashQuery = useMemo(() => {
    const query = currentSkillSlashQueryAtCursor(runtime.composer, composerCursorChars);
    if (!query) {
      return undefined;
    }
    if (dismissedSlashQueryKey === skillSlashQueryKey(query)) {
      return undefined;
    }
    return query;
  }, [composerCursorChars, dismissedSlashQueryKey, runtime.composer]);

  const slashSuggestions = useMemo(
    () => buildSkillSlashSuggestions(slashQuery?.raw, snapshot?.skillsList ?? []),
    [slashQuery, snapshot?.skillsList],
  );

  const fileReferenceQuery = useMemo(
    () => currentWorkspaceFileReferenceQuery(runtime.composer, composerCursorChars),
    [composerCursorChars, runtime.composer],
  );

  const fileReferenceQueryKey = useMemo(
    () =>
      fileReferenceQuery
        ? `${fileReferenceQuery.start}\u0000${fileReferenceQuery.end}\u0000${fileReferenceQuery.raw}`
        : "",
    [fileReferenceQuery],
  );

  const workspaceFileIndex = useWorkspaceFileIndex({
    workspaceRoot: snapshot?.workspaceRoot ?? "",
    workspaceBinding: snapshot?.workspaceBinding ?? "project",
    primeWorkspaceFileReferenceIndex: runtime.primeWorkspaceFileReferenceIndex,
    getWorkspaceFileReferenceIndex: runtime.getWorkspaceFileReferenceIndex,
  });

  useEffect(() => {
    setSlashSelectedIndex(-1);
  }, [slashQuery?.raw, slashQuery?.start, slashQuery?.end]);

  useEffect(() => {
    if (!fileReferenceQuery || dismissedFileReferenceKey === fileReferenceQueryKey) {
      setFileReferenceSuggestions(null);
      setFileReferenceSelectedIndex(-1);
      return;
    }

    if (!workspaceFileIndex.ready) {
      setFileReferenceSuggestions({
        query: fileReferenceQuery,
        suggestions: [],
      });
      return;
    }

    setFileReferenceSuggestions({
      query: fileReferenceQuery,
      suggestions: workspaceFileIndex.search(fileReferenceQuery.raw),
    });
  }, [
    dismissedFileReferenceKey,
    fileReferenceQuery,
    fileReferenceQueryKey,
    workspaceFileIndex.ready,
    workspaceFileIndex.fileCount,
    workspaceFileIndex.search,
  ]);

  useEffect(() => {
    if (slashSuggestions.length === 0) {
      if (slashSelectedIndex !== -1) {
        setSlashSelectedIndex(-1);
      }
      return;
    }
    if (slashSelectedIndex >= slashSuggestions.length) {
      setSlashSelectedIndex(-1);
    }
  }, [slashSelectedIndex, slashSuggestions.length]);

  useEffect(() => {
    const suggestionCount = fileReferenceSuggestions?.suggestions.length ?? 0;
    if (suggestionCount === 0) {
      if (fileReferenceSelectedIndex !== -1) {
        setFileReferenceSelectedIndex(-1);
      }
      return;
    }

    if (fileReferenceSelectedIndex >= suggestionCount) {
      setFileReferenceSelectedIndex(-1);
    }
  }, [fileReferenceSelectedIndex, fileReferenceSuggestions?.suggestions.length]);

  const handleComposerAgentModeChange = useCallback(
    (agentMode: DesktopAgentMode) => {
      void runtime.saveSettingsPatch({ agentMode });
      if (agentMode === "plan" || agentMode === "ask" || agentMode === "debug") {
        runtime.setAgentModeChipDismissed(false);
      }
      if (agentMode === "plan") {
        composerRichInputRef.current?.insertPlanChip({ clearText: false });
      } else if (agentMode === "ask") {
        composerRichInputRef.current?.insertAskChip({ clearText: false });
      } else if (agentMode === "debug") {
        composerRichInputRef.current?.insertDebugChip({ clearText: false });
      } else {
        composerRichInputRef.current?.removeAgentModeChip();
      }
    },
    [runtime],
  );

  const applySlashSuggestion = useCallback(
    (replacement: string) => {
      if (slashQuery) {
        composerRichInputRef.current?.replaceSkillSlashQuery(slashQuery, replacement, true);
      } else {
        runtime.setComposer(replacement);
      }
      setSlashSelectedIndex(-1);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.focus();
      });
    },
    [runtime, slashQuery],
  );

  const applyLoopSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    void runtime.setLoopEnabled(true);
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
    composerRichInputRef.current?.insertLoopChip({ clearText: false });
  }, [runtime, slashQuery]);

  const applyPlanSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    void runtime.saveSettingsPatch({ agentMode: "plan" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertPlanChip({ clearText: false });
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
  }, [runtime, slashQuery]);

  const applyAskSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    void runtime.saveSettingsPatch({ agentMode: "ask" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertAskChip({ clearText: false });
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
  }, [runtime, slashQuery]);

  const applyDebugSlash = useCallback(() => {
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    void runtime.saveSettingsPatch({ agentMode: "debug" });
    runtime.setAgentModeChipDismissed(false);
    composerRichInputRef.current?.insertDebugChip({ clearText: false });
    if (slashQuery) {
      composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
    }
  }, [runtime, slashQuery]);

  const applyForkSlash = useCallback(() => {
    const messages = snapshot?.conversation.messages ?? [];
    const messageId = findLastForkableAssistantMessageId(messages);
    const conversationBusy = snapshot?.conversation.isBusy === true;
    const forkBusy = runtime.busyAction === "fork";
    if (
      !messageId
      || !canForkSession({
        conversationBusy,
        activeSessionReadOnly,
        forkBusy,
        hasForkableAssistantMessage: true,
      })
    ) {
      return;
    }
    setSlashSelectedIndex(-1);
    setDismissedSlashQueryKey(null);
    runtime.setComposer("");
    composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
    void runtime.forkSession({ messageId });
  }, [activeSessionReadOnly, runtime, snapshot?.conversation.isBusy, snapshot?.conversation.messages]);

  const applySlashSuggestionItem = useCallback(
    (suggestion: SkillSlashSuggestion) => {
      if (suggestion.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (suggestion.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (suggestion.kind === "ask") {
        applyAskSlash();
        return;
      }
      if (suggestion.kind === "debug") {
        applyDebugSlash();
        return;
      }
      if (suggestion.kind === "fork") {
        applyForkSlash();
        return;
      }
      if (suggestion.kind === "skill") {
        setSlashSelectedIndex(-1);
        setDismissedSlashQueryKey(null);
        if (slashQuery) {
          composerRichInputRef.current?.removeSkillSlashQuery(slashQuery);
        }
        queueMicrotask(() => {
          composerRichInputRef.current?.insertSkillChip(suggestion.alias);
        });
        return;
      }
      applySlashSuggestion(`${suggestion.alias} `);
    },
    [applyAskSlash, applyDebugSlash, applyForkSlash, applyLoopSlash, applyPlanSlash, applySlashSuggestion, slashQuery],
  );

  const ensureConversationSurface = useCallback(() => {
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
  }, [setActiveSurface, setLastNonSettingsSurface]);

  const prefillComposerSkillChip = useCallback(
    (skillName: string) => {
      const alias = skillSlashAlias(skillName);
      setLastNonSettingsSurface("conversation");
      setActiveSurface("conversation");
      runtime.setComposer("");
      setSlashSelectedIndex(-1);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.insertSkillChip(alias, {
          clearText: true,
          appendTrailingSpace: true,
        });
        composerRichInputRef.current?.focus();
      });
    },
    [runtime, setActiveSurface, setLastNonSettingsSurface],
  );

  const isActionPaletteItemDisabled = useCallback(
    (item: ActionPaletteItem) => {
      if (!runtime.busyAction) {
        return false;
      }
      if (isNewSessionAction(item)) {
        return true;
      }
      return item.kind === "log-session" || item.kind === "compact" || item.kind === "fork";
    },
    [runtime.busyAction],
  );

  const runActionPaletteItem = useCallback(
    (item: ActionPaletteItem) => {
      ensureConversationSurface();
      if (isNewSessionAction(item)) {
        handleNewSession();
        return;
      }
      if (item.kind === "loop") {
        applyLoopSlash();
        return;
      }
      if (item.kind === "plan") {
        applyPlanSlash();
        return;
      }
      if (item.kind === "ask") {
        applyAskSlash();
        return;
      }
      if (item.kind === "debug") {
        applyDebugSlash();
        return;
      }
      if (item.kind === "fork") {
        applyForkSlash();
        return;
      }
      if (item.kind === "log-session" || item.kind === "compact") {
        void runtime.sendMessage({ text: item.alias });
        return;
      }
      applySlashSuggestion(`${item.alias} `);
    },
    [
      applyAskSlash,
      applyDebugSlash,
      applyForkSlash,
      applyLoopSlash,
      applyPlanSlash,
      applySlashSuggestion,
      ensureConversationSurface,
      handleNewSession,
      runtime,
    ],
  );

  const applyFileReferenceSuggestion = useCallback(
    (path: string) => {
      const query = fileReferenceSuggestions?.query;
      if (!query) {
        return;
      }

      composerRichInputRef.current?.insertWorkspaceFileReference(path, query, true);
      setFileReferenceSelectedIndex(-1);
      setDismissedFileReferenceKey(null);
    },
    [fileReferenceSuggestions?.query],
  );

  const insertComposerText = useCallback(
    (text: string) => {
      const segments = composerRichInputRef.current?.getSegments() ?? [];
      const hasRichChips = segments.some((segment) => segment.kind !== "text");
      if (hasRichChips) {
        composerRichInputRef.current?.insertPlainTextAtCaret(text);
      } else {
        const selectionStart = composerCursorCodeUnits;
        const selectionEnd = selectionStart;
        const nextValue = `${runtime.composer.slice(0, selectionStart)}${text}${runtime.composer.slice(selectionEnd)}`;
        const nextCursorCodeUnits = selectionStart + text.length;
        runtime.setComposer(nextValue);
        setComposerCursorCodeUnits(nextCursorCodeUnits);
      }
      setSlashSelectedIndex(-1);
      setFileReferenceSelectedIndex(-1);
      setFileReferenceSuggestions(null);
      setDismissedFileReferenceKey(null);
      setDismissedSlashQueryKey(null);
      queueMicrotask(() => {
        composerRichInputRef.current?.focus();
      });
    },
    [composerCursorCodeUnits, runtime],
  );

  const insertFileReferenceTrigger = useCallback(() => {
    insertComposerText("@");
  }, [insertComposerText]);

  const insertSkillTriggerFromPalette = useCallback(() => {
    insertComposerText("/");
  }, [insertComposerText]);

  const removeLocalFileAttachment = useCallback((path: string) => {
    removeComposerLocalFileAttachment(runtime.setComposerLocalFileAttachments, path);
  }, [runtime.setComposerLocalFileAttachments]);

  const attachLocalFilePath = useCallback(
    (filePath: string) => {
      appendComposerLocalFileAttachment(runtime.setComposerLocalFileAttachments, filePath, {
        onAfterAttach: () => {
          queueMicrotask(() => {
            composerRichInputRef.current?.focus();
          });
        },
      });
    },
    [runtime.setComposerLocalFileAttachments],
  );

  const handleBrowserElementPicked = useCallback(
    async (attachment: BrowserElementAttachment) => {
      composerRichInputRef.current?.insertAttachment(attachment);
      const base64 = attachment.screenshotDataUrl.replace(/^data:image\/png;base64,/, "");
      const bridge = window.spiritDesktop;
      if (bridge?.ingestBrowserElementScreenshot) {
        const filePath = await bridge.ingestBrowserElementScreenshot(base64);
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      }
    },
    [attachLocalFilePath],
  );

  const handlePrDiffAddToSession = useCallback((attachment: PrDiffAttachment) => {
    composerRichInputRef.current?.insertPrDiffAttachment(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleGitCommitAddToSession = useCallback((attachment: GitCommitAttachment) => {
    ensureConversationSurface();
    composerRichInputRef.current?.insertGitCommitAttachment(attachment);
    composerRichInputRef.current?.focus();
  }, [ensureConversationSurface]);

  const handleTerminalAddToSession = useCallback((attachment: TerminalSnippetAttachment) => {
    composerRichInputRef.current?.insertTerminalSnippet(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleFileSnippetAddToSession = useCallback((attachment: FileSnippetAttachment) => {
    composerRichInputRef.current?.insertFileSnippet(attachment);
    composerRichInputRef.current?.focus();
  }, []);

  const handleWorkspaceFileAddToSession = useCallback(
    (relativePath: string) => {
      ensureConversationSurface();
      composerRichInputRef.current?.insertWorkspaceFileAtCaret(relativePath);
      composerRichInputRef.current?.focus();
    },
    [ensureConversationSurface],
  );

  const pickLocalFileFromPalette = useCallback(() => {
    void runtime.pickLocalFile().then((filePath) => {
      if (!filePath) {
        return;
      }
      attachLocalFilePath(filePath);
    });
  }, [attachLocalFilePath, runtime]);

  const handleComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron") {
        return;
      }

      const hasClipboardImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (!hasClipboardImage) {
        return;
      }

      event.preventDefault();
      void runtime.ingestClipboardImage().then((filePath) => {
        if (filePath) {
          attachLocalFilePath(filePath);
        }
      });
    },
    [activeSessionReadOnly, attachLocalFilePath, runtime],
  );

  const submitComposerMessage = useCallback(() => {
    const segs = composerRichInputRef.current?.getSegments() ?? [];
    const fullText = segmentsToMessageText(segs) || runtime.composer;
    const trimmed = fullText.trim();
    if (trimmed === FORK_SLASH_ALIAS) {
      applyForkSlash();
      return;
    }
    const payload = {
      text: fullText,
      ...(runtime.composerLocalFileAttachments.length > 0
        ? {
            localFilePaths: runtime.composerLocalFileAttachments.map((item) => item.path),
          }
        : {}),
    };

    if (shouldPromptGitBranchCheckoutBeforeSend({ isEmptySession, git: snapshot?.git })) {
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (selectedBranch) {
        pendingComposerSendRef.current = payload;
        setBranchCheckoutDialogOpen(true);
        return;
      }
    }

    void runtime.sendMessage(payload).then((ok) => {
      if (ok) {
        setComposerBrowserElementAttachments([]);
        composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
      }
    });
  }, [applyForkSlash, isEmptySession, runtime, snapshot?.git]);

  const confirmBranchCheckoutAndSend = useCallback(() => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await runtime.checkoutGitBranch(selectedBranch);
      if (result.ok) {
        pendingComposerSendRef.current = null;
        setBranchCheckoutBlockedByChanges(false);
        setBranchCheckoutDialogOpen(false);
        void runtime.sendMessage(pending).then((ok) => {
          if (ok) {
            composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
          }
        });
        return;
      }

      if (result.reason === "local-changes") {
        setBranchCheckoutBlockedByChanges(true);
      }
    })();
  }, [runtime, snapshot?.git]);

  const discardBranchChangesAndCheckoutSend = useCallback(() => {
    void (async () => {
      const pending = pendingComposerSendRef.current;
      const selectedBranch = snapshot?.git.selectedBranch ?? snapshot?.git.branch;
      if (!pending || !selectedBranch) {
        setBranchCheckoutDialogOpen(false);
        return;
      }

      const result = await runtime.checkoutGitBranch(selectedBranch, { discardLocalChanges: true });
      if (!result.ok) {
        return;
      }

      pendingComposerSendRef.current = null;
      setBranchCheckoutBlockedByChanges(false);
      setBranchCheckoutDialogOpen(false);
      void runtime.sendMessage(pending).then((ok) => {
        if (ok) {
          composerRichInputRef.current?.resetAfterSend(runtime.settings.agentMode);
        }
      });
    })();
  }, [runtime, snapshot?.git]);

  const handleBranchCheckoutDialogOpenChange = useCallback((open: boolean) => {
    setBranchCheckoutDialogOpen(open);
    if (!open) {
      pendingComposerSendRef.current = null;
      setBranchCheckoutBlockedByChanges(false);
    }
  }, []);

  const cancelBranchCheckoutDialog = useCallback(() => {
    pendingComposerSendRef.current = null;
    setBranchCheckoutBlockedByChanges(false);
    setBranchCheckoutDialogOpen(false);
  }, []);

  const handleComposerSuggestionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const fileReferenceItems = fileReferenceSuggestions?.suggestions ?? [];

      if (slashQuery) {
        if (event.key === "Escape") {
          event.preventDefault();
          setDismissedSlashQueryKey(skillSlashQueryKey(slashQuery));
          setSlashSelectedIndex(-1);
          return;
        }

        if (slashSuggestions.length > 0) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashSelectedIndex((current) => {
              if (current < 0) {
                return 0;
              }
              return (current + 1) % slashSuggestions.length;
            });
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashSelectedIndex((current) =>
              current <= 0 ? slashSuggestions.length - 1 : current - 1,
            );
            return;
          }

          if (event.key === "Tab") {
            event.preventDefault();
            const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
            if (selected) {
              applySlashSuggestionItem(selected);
            }
            return;
          }

          if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            event.preventDefault();
            const selected = slashSuggestions[slashSelectedIndex] ?? slashSuggestions[0];
            if (selected) {
              applySlashSuggestionItem(selected);
            }
            return;
          }
        }
      }

      if (fileReferenceItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setFileReferenceSelectedIndex((current) => {
            if (current < 0) {
              return 0;
            }
            return (current + 1) % fileReferenceItems.length;
          });
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setFileReferenceSelectedIndex((current) =>
            current <= 0 ? fileReferenceItems.length - 1 : current - 1,
          );
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setDismissedFileReferenceKey(fileReferenceQueryKey);
          setFileReferenceSelectedIndex(-1);
          setFileReferenceSuggestions(null);
          return;
        }

        if (event.key === "Tab") {
          event.preventDefault();
          const selected = fileReferenceItems[fileReferenceSelectedIndex] ?? fileReferenceItems[0];
          if (selected) {
            applyFileReferenceSuggestion(selected);
          }
          return;
        }

        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          const selected = fileReferenceItems[fileReferenceSelectedIndex] ?? fileReferenceItems[0];
          if (selected) {
            applyFileReferenceSuggestion(selected);
          }
        }
      }
    },
    [
      applyFileReferenceSuggestion,
      applySlashSuggestionItem,
      fileReferenceQueryKey,
      fileReferenceSelectedIndex,
      fileReferenceSuggestions?.suggestions,
      slashQuery,
      slashSelectedIndex,
      slashSuggestions,
    ],
  );

  const handleComposerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      handleComposerSuggestionKeyDown(event);
      if (event.defaultPrevented) {
        return;
      }
      if (
        event.key === "Tab" &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const nextMode = cycleAgentMode(runtime.settings.agentMode);
        handleComposerAgentModeChange(nextMode);
        return;
      }
      if (
        pendingApproval &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing &&
        runtime.busyAction !== "approve"
      ) {
        event.preventDefault();
        void runtime.submitApproval({ kind: "allow" });
      }
    },
    [
      handleComposerAgentModeChange,
      handleComposerSuggestionKeyDown,
      pendingApproval,
      runtime,
    ],
  );

  const focusComposer = useCallback(() => {
    composerRichInputRef.current?.focus();
  }, []);

  return {
    composerBrowserElementAttachments,
    setComposerBrowserElementAttachments,
    composerCursorCodeUnits,
    setComposerCursorCodeUnits,
    slashSelectedIndex,
    setSlashSelectedIndex,
    fileReferenceSuggestions,
    fileReferenceSelectedIndex,
    setFileReferenceSelectedIndex,
    filePickerOpen,
    setFilePickerOpen,
    actionPickerOpen,
    setActionPickerOpen,
    branchCheckoutDialogOpen,
    branchCheckoutBlockedByChanges,
    handleBranchCheckoutDialogOpenChange,
    cancelBranchCheckoutDialog,
    composerRichInputRef,
    handleComposerAgentModeChange,
    slashQuery,
    slashSuggestions,
    applySlashSuggestionItem,
    prefillComposerSkillChip,
    runActionPaletteItem,
    isActionPaletteItemDisabled,
    applyFileReferenceSuggestion,
    insertComposerText,
    insertFileReferenceTrigger,
    insertSkillTriggerFromPalette,
    removeLocalFileAttachment,
    handleBrowserElementPicked,
    handlePrDiffAddToSession,
    handleGitCommitAddToSession,
    handleTerminalAddToSession,
    handleFileSnippetAddToSession,
    handleWorkspaceFileAddToSession,
    pickLocalFileFromPalette,
    handleComposerPaste,
    submitComposerMessage,
    confirmBranchCheckoutAndSend,
    discardBranchChangesAndCheckoutSend,
    handleComposerSuggestionKeyDown,
    handleComposerKeyDown,
    workspaceFileIndex,
    composerPlaceholder,
    composerCanSend,
    messageRewindComposerEnabled,
    commitBusy,
    gitChipBusy,
    focusComposer,
  };
}
