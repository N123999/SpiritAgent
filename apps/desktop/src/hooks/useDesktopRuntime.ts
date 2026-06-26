import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildSingleTextQuestionNotificationReplyResult } from "@/lib/ask-questions-notification-reply";
import i18n from "@/lib/i18n";

import type { SettingsFormState } from "@/components/settings/types";
import { useHostApi } from "@/hooks/useHostApi";
import {
  clearComposerDraft,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/composer-draft-store";
import {
  composerAttachmentViewFromPath,
  type ComposerLocalFileAttachmentView,
} from "@/lib/local-file-attachments";
import {
  isCompactSlashInput,
  isLogSessionSlashInput,
  matchSkillSlashInput,
} from "@/lib/skill-slash";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { isAgentModeChipKind } from "@/lib/composer-agent-mode-segments";
import { clearGitHubAutomationRepositoriesCache } from "@/lib/github-automation-repositories-cache";
import { isRunSubagentToolCallPending } from "@/lib/subagent-viewer-pending";
import { resolveWorkspaceGroupingRoot } from "@/lib/workspace-grouping";
import { useDesktopSystemNotifications } from "@/hooks/useDesktopSystemNotifications";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  AskQuestionsAnswer,
  AskQuestionsQuestionSpec,
  AskQuestionsRequest,
  AskQuestionsResult,
  BootstrapRequest,
  CommitChangesRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteRuleRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteHookEntryRequest,
  DeleteSkillRequest,
  DesktopApprovalDecision,
  DesktopModelReasoningEffort,
  DesktopAutomationDetail,
  DesktopAutomationListItem,
  DesktopCreateAutomationRequest,
  DesktopDreamOverviewItem,
  DesktopUpdateAutomationRequest,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  SaveHookEntryRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RewindAndSubmitMessageRequest,
  ForkSessionRequest,
  SessionListItem,
  SubmitGitChipRequest,
  SubmitUserTurnRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  HostTextFileStatResult,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  DesktopModelProvider,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  GetGitHubPullRequestDetailRequest,
  GetGitHubPullRequestTabCountsRequest,
  ListGitHubPullRequestsRequest,
  SearchGitHubAutomationRepositoriesRequest,
  MergeGitHubPullRequestRequest,
} from "@/types";

type BusyAction =
  | ""
  | "bootstrap"
  | "send"
  | "continue"
  | "rewind"
  | "fork"
  | "approve"
  | "questions"
  | "reset"
  | "session"
  | "models"
  | "modelsPreview"
  | "mcps"
  | "hooks"
  | "skills"
  | "rules"
  | "extensions"
  | "lspInstall"
  | "marketplace"
  | "git"
  | "automation";

const DREAM_IDLE_POLL_INTERVAL_MS = 30_000;
const GIT_STATE_POLL_INTERVAL_MS = 5_000;
const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 400;

type SessionUiState = {
  composer: string;
  questionDrafts: Record<string, QuestionDraft>;
  localFilePaths: string[];
  agentModeChipDismissed: boolean;
};

function pathsFromComposerAttachments(
  attachments: readonly ComposerLocalFileAttachmentView[],
): string[] {
  return attachments.map((attachment) => attachment.path);
}

function attachmentsFromPaths(paths: readonly string[]): ComposerLocalFileAttachmentView[] {
  return paths.map((filePath) => composerAttachmentViewFromPath(filePath));
}

function persistSessionUiDraft(
  sessionKey: string,
  state: Pick<SessionUiState, "composer" | "localFilePaths">,
): void {
  writeComposerDraft(sessionKey, {
    text: state.composer,
    localFilePaths: state.localFilePaths,
  });
}

export interface QuestionDraft {
  selectedOptionIndexes: number[];
  customInput: string;
  text: string;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export type CheckoutGitBranchResult =
  | { ok: true }
  | { ok: false; reason: "local-changes" }
  | { ok: false; reason: "error" };

function isCheckoutBlockedByLocalChanges(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "GIT_CHECKOUT_LOCAL_CHANGES") {
      return true;
    }
  }

  const message = describeError(error);
  return /local changes to the following files would be overwritten by checkout/i.test(message)
    || /please commit your changes or stash them before you switch branches/i.test(message)
    || message.includes(i18n.t('error.uncommittedChangesBlockCheckout'));
}

function sanitizeGitErrorMessage(error: unknown): string {
  return describeError(error)
    .replace(/^Error invoking remote method 'desktop:invoke': Error: /u, "")
    .replace(/^Error invoking remote method 'desktop:invoke': /u, "");
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function updateConfigFromSettingsForm(
  s: SettingsFormState,
  webHost: NonNullable<UpdateConfigRequest["webHost"]>,
): UpdateConfigRequest {
  return {
    activeModel: s.activeModel,
    imageGenerationModel: s.imageGenerationModel,
    videoGenerationModel: s.videoGenerationModel,
    lightweightChatModel: s.lightweightChatModel,
    apiBase: s.apiBase,
    windowsMica: s.windowsMica,
    systemNotifications: s.systemNotifications,
    agentMode: s.agentMode,
    webHost,
    dreams: {
      enabled: s.dreamEnabled,
      clearCollectorModel: true,
      debugMode: s.dreamDebugMode,
    },
    agents: {
      lsp: {
        enabled: s.lspEnabled,
      },
      codeCompletion: {
        enabled: s.codeCompletionEnabled,
      },
    },
    networks: {
      llmHttpVersion: s.llmHttpVersion,
    },
    ...(s.uiLocale.trim() ? { uiLocale: s.uiLocale.trim() } : { uiLocale: undefined }),
    ...(s.apiKey.trim() ? { apiKey: s.apiKey.trim() } : undefined),
  };
}

function toUniqueIndexes(indexes: number[]): number[] {
  return Array.from(new Set(indexes)).sort((left, right) => left - right);
}

function buildAskQuestionsAnswer(
  question: AskQuestionsQuestionSpec,
  draft: QuestionDraft,
): AskQuestionsAnswer {
  const selectedOptionIndexes = toUniqueIndexes(draft.selectedOptionIndexes).filter(
    (index) => index >= 0 && index < question.options.length,
  );
  const selectedOptionLabels = selectedOptionIndexes
    .map((index) => question.options[index]?.label)
    .filter((label): label is string => typeof label === "string" && label.trim().length > 0);
  const customInput = draft.customInput.trim();
  const text = draft.text.trim();

  if (question.kind === "text") {
    return {
      questionId: question.id,
      title: question.title,
      kind: question.kind,
      answered: text.length > 0,
      text: text || undefined,
    };
  }

  return {
    questionId: question.id,
    title: question.title,
    kind: question.kind,
    answered: selectedOptionIndexes.length > 0 || customInput.length > 0,
    selectedOptionIndexes:
      selectedOptionIndexes.length > 0 ? selectedOptionIndexes : undefined,
    selectedOptionLabels:
      selectedOptionLabels.length > 0 ? selectedOptionLabels : undefined,
    customInput: customInput || undefined,
  };
}

function buildAskQuestionsResult(
  request: AskQuestionsRequest,
  drafts: Record<string, QuestionDraft>,
): { result?: AskQuestionsResult; error?: string } {
  const answers = request.questions.map((question) =>
    buildAskQuestionsAnswer(question, drafts[question.id] ?? emptyQuestionDraft()),
  );

  const missingRequired = request.questions.find((question, index) => {
    return question.required && !answers[index]?.answered;
  });

  if (missingRequired) {
    return {
      error: i18n.t('error.completeRequiredQuestion', { title: missingRequired.title }),
    };
  }

  return {
    result: {
      status: "answered",
      answers,
    },
  };
}

function emptyQuestionDraft(): QuestionDraft {
  return {
    selectedOptionIndexes: [],
    customInput: "",
    text: "",
  };
}

function shouldRefreshDreamSessions(prev: DesktopSnapshot, next: DesktopSnapshot): boolean {
  if (!next.dreams.settings.debugMode) {
    return false;
  }

  return (
    prev.dreams.collector.state !== next.dreams.collector.state ||
    prev.dreams.collector.processedCount !== next.dreams.collector.processedCount ||
    prev.dreams.collector.lastSuccessAtUnixMs !== next.dreams.collector.lastSuccessAtUnixMs
  );
}

export function useDesktopRuntime() {
  const { api, error: hostError, kind, ready: hostReady } = useHostApi();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [webHostPairingRequired, setWebHostPairingRequired] = useState(false);
  const [composer, setComposer] = useState("");
  const [approvalGuidance, setApprovalGuidance] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [settings, setSettings] = useState<SettingsFormState>({
    activeModel: "",
    imageGenerationModel: "",
    videoGenerationModel: "",
    lightweightChatModel: "",
    apiBase: "",
    uiLocale: "",
    apiKey: "",
    windowsMica: true,
    systemNotifications: true,
    agentMode: "agent",
    webHostEnabled: false,
    webHostHost: "127.0.0.1",
    webHostPort: 7788,
    dreamEnabled: false,
    dreamDebugMode: false,
    lspEnabled: true,
    codeCompletionEnabled: true,
    llmHttpVersion: "http2",
  });
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [unseenCompletedSessionPaths, setUnseenCompletedSessionPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sessionsBusySnapshotRef = useRef<Map<string, boolean>>(new Map());
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [composerLocalFileAttachments, setComposerLocalFileAttachments] = useState<
    ComposerLocalFileAttachmentView[]
  >([]);
  const [agentModeChipDismissed, setAgentModeChipDismissed] = useState(false);
  const agentModeChipDismissedRef = useRef(false);
  const appliedConversationRevisionRef = useRef(0);
  const appliedComposerSessionKeyRef = useRef("");
  const sessionNavigationGenerationRef = useRef(0);
  const busyActionRef = useRef<BusyAction>("");
  const settingsRef = useRef(settings);
  const snapshotRef = useRef<DesktopSnapshot | null>(null);
  const micaSaveSeqRef = useRef(0);
  const micaInFlightRef = useRef(0);
  const sessionUiCacheRef = useRef(new Map<string, SessionUiState>());

  const sessionUiKey = useCallback((sessionKey: string | undefined) => sessionKey?.trim() || "", []);

  const clearActiveComposerDraft = useCallback(() => {
    const key = sessionUiKey(snapshotRef.current?.composerSessionKey);
    setComposer("");
    setComposerLocalFileAttachments([]);
    setAgentModeChipDismissed(false);
    if (!key) {
      return;
    }
    sessionUiCacheRef.current.delete(key);
    clearComposerDraft(key);
  }, [sessionUiKey]);

  const stashSessionUi = useCallback(
    (targetSnapshot: Pick<DesktopSnapshot, "composerSessionKey" | "activeSession"> | null | undefined) => {
      const snapshotLike = targetSnapshot ?? snapshotRef.current;
      if (snapshotLike?.activeSession?.readOnly) {
        return;
      }
      const key = sessionUiKey(snapshotLike?.composerSessionKey);
      if (!key) {
        return;
      }
      const state: SessionUiState = {
        composer,
        questionDrafts,
        localFilePaths: pathsFromComposerAttachments(composerLocalFileAttachments),
        agentModeChipDismissed,
      };
      sessionUiCacheRef.current.set(key, state);
      persistSessionUiDraft(key, state);
    },
    [agentModeChipDismissed, composer, composerLocalFileAttachments, questionDrafts, sessionUiKey],
  );

  const restoreSessionUi = useCallback(
    (targetSnapshot: Pick<DesktopSnapshot, "composerSessionKey" | "activeSession"> | null | undefined) => {
      const snapshotLike = targetSnapshot ?? snapshotRef.current;
      const key = sessionUiKey(snapshotLike?.composerSessionKey);
      if (snapshotLike?.activeSession?.readOnly) {
        setComposer("");
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setAgentModeChipDismissed(false);
        setQuestionError("");
        return;
      }
      if (!key) {
        setComposer("");
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setAgentModeChipDismissed(false);
        setQuestionError("");
        return;
      }
      const cached = sessionUiCacheRef.current.get(key);
      if (cached) {
        setComposer(cached.composer);
        setQuestionDrafts(cached.questionDrafts);
        setComposerLocalFileAttachments(attachmentsFromPaths(cached.localFilePaths));
        setAgentModeChipDismissed(cached.agentModeChipDismissed ?? false);
        setQuestionError("");
        return;
      }
      const stored = readComposerDraft(key);
      setComposer(stored?.text ?? "");
      setQuestionDrafts({});
      setComposerLocalFileAttachments(attachmentsFromPaths(stored?.localFilePaths ?? []));
      setAgentModeChipDismissed(false);
      setQuestionError("");
    },
    [sessionUiKey],
  );

  useEffect(() => {
    agentModeChipDismissedRef.current = agentModeChipDismissed;
  }, [agentModeChipDismissed]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    busyActionRef.current = busyAction;
  }, [busyAction]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (
      busyAction === "bootstrap" ||
      busyAction === "session" ||
      busyAction === "reset" ||
      snapshot?.activeSession?.readOnly
    ) {
      return;
    }
    const key = sessionUiKey(snapshot?.composerSessionKey);
    if (!key) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const localFilePaths = pathsFromComposerAttachments(composerLocalFileAttachments);
      sessionUiCacheRef.current.set(key, {
        composer,
        questionDrafts,
        localFilePaths,
        agentModeChipDismissed,
      });
      persistSessionUiDraft(key, { composer, localFilePaths });
    }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [
    agentModeChipDismissed,
    busyAction,
    composer,
    composerLocalFileAttachments,
    questionDrafts,
    sessionUiKey,
    snapshot?.activeSession?.readOnly,
    snapshot?.composerSessionKey,
  ]);

  const applySnapshot = useCallback((next: DesktopSnapshot, options?: { navGeneration?: number }) => {
    if (
      options?.navGeneration === undefined &&
      (busyActionRef.current === "session" || busyActionRef.current === "reset")
    ) {
      return;
    }

    if (
      options?.navGeneration !== undefined &&
      options.navGeneration !== sessionNavigationGenerationRef.current
    ) {
      return;
    }

    const revision = next.conversation.revision ?? 0;
    const sessionKey = next.composerSessionKey;
    const sameSession = sessionKey === appliedComposerSessionKeyRef.current;
    if (sameSession && revision < appliedConversationRevisionRef.current) {
      return;
    }

    if (!sameSession) {
      appliedConversationRevisionRef.current = 0;
    }

    appliedComposerSessionKeyRef.current = sessionKey;
    appliedConversationRevisionRef.current = revision;
    setSnapshot(next);
    setRuntimeError(next.runtimeError ?? "");
    setSettings((current) => {
      const activeModelProfile = next.config.models.find(
        (model) => model.name === next.config.activeModel,
      );
      const configAgentMode = (next.config.agentMode ?? "agent") as DesktopAgentMode;
      // 回合进行中 poll 可能仍带旧 config.agentMode；勿覆盖用户 dismiss Chip 后 saveSettingsPatch 的乐观 agentMode。
      const turnInFlight =
        next.conversation.isBusy === true || busyActionRef.current === "send";
      const chipDismissed = agentModeChipDismissedRef.current;
      let agentMode: DesktopAgentMode =
        turnInFlight && current.agentMode !== configAgentMode
          ? current.agentMode
          : configAgentMode;
      // saveSettingsPatch 乐观更新后、poll 快照尚未追上时，勿覆盖本地 chip 模式。
      if (
        !chipDismissed &&
        isAgentModeChipKind(current.agentMode) &&
        current.agentMode !== configAgentMode
      ) {
        agentMode = current.agentMode;
      }
      // 用户 Backspace 去掉 chip 后，poll 不得再把 settings.agentMode 设回 ask/plan（否则 agentMode effect 会重插 chip）。
      if (chipDismissed && isAgentModeChipKind(agentMode)) {
        agentMode = "agent";
      }

      const snapshotWindowsMica = next.config.windowsMica !== false;
      const windowsMica =
        micaInFlightRef.current > 0 && current.windowsMica !== snapshotWindowsMica
          ? current.windowsMica
          : snapshotWindowsMica;

      return {
        activeModel: next.config.activeModel,
        imageGenerationModel: next.config.imageGenerationModel ?? "",
        videoGenerationModel: next.config.videoGenerationModel ?? "",
        lightweightChatModel: next.config.lightweightChatModel ?? "",
        apiBase: activeModelProfile?.apiBase ?? current.apiBase,
        uiLocale: next.config.uiLocale ?? "",
        apiKey: current.apiKey,
        windowsMica,
        systemNotifications: next.config.systemNotifications !== false,
        agentMode,
        webHostEnabled: next.webHost.config.enabled,
        webHostHost: next.webHost.config.host,
        webHostPort: next.webHost.config.port,
        dreamEnabled: next.dreams.settings.enabled,
        dreamDebugMode: next.dreams.settings.debugMode,
        lspEnabled: next.lsp.userEnabled,
        codeCompletionEnabled: next.codeCompletion.userEnabled,
        llmHttpVersion: next.config.networks.llmHttpVersion,
      };
    });
  }, []);

  const acknowledgeSessionAttention = useCallback((path: string) => {
    setUnseenCompletedSessionPaths((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const applySessionList = useCallback((list: SessionListItem[]) => {
    const prev = sessionsBusySnapshotRef.current;
    const nextBusy = new Map<string, boolean>();
    const newlyCompleted: string[] = [];

    for (const session of list) {
      const wasBusy = prev.get(session.path) === true;
      const nowBusy = session.isBusy === true;
      nextBusy.set(session.path, nowBusy);
      if (wasBusy && !nowBusy && !session.isActive && !session.isBlocked) {
        newlyCompleted.push(session.path);
      }
    }
    sessionsBusySnapshotRef.current = nextBusy;

    if (newlyCompleted.length > 0) {
      setUnseenCompletedSessionPaths((current) => {
        const next = new Set(current);
        for (const path of newlyCompleted) {
          next.add(path);
        }
        return next;
      });
    }

    setSessions(list);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const list = await api.listSessions();
      applySessionList(list);
    } catch {
      sessionsBusySnapshotRef.current = new Map();
      setSessions([]);
    }
  }, [api, applySessionList]);

  const listDreamsOverview = useCallback(async (): Promise<DesktopDreamOverviewItem[]> => {
    if (!api) {
      return [];
    }
    return api.listDreamsOverview();
  }, [api]);

  const listAutomations = useCallback(async (): Promise<DesktopAutomationListItem[]> => {
    if (!api) {
      return [];
    }
    return api.listAutomations();
  }, [api]);

  const getAutomation = useCallback(async (automationId: string): Promise<DesktopAutomationDetail | undefined> => {
    if (!api) {
      return undefined;
    }
    return api.getAutomation(automationId);
  }, [api]);

  const createAutomation = useCallback(async (request: DesktopCreateAutomationRequest) => {
    if (!api) {
      return;
    }
    setBusyAction("automation");
    try {
      const next = await api.createAutomation(request);
      applySnapshot(next);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot]);

  const updateAutomation = useCallback(async (automationId: string, patch: DesktopUpdateAutomationRequest) => {
    if (!api) {
      return;
    }
    setBusyAction("automation");
    try {
      const next = await api.updateAutomation(automationId, patch);
      applySnapshot(next);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot]);

  const deleteAutomation = useCallback(async (automationId: string) => {
    if (!api) {
      return;
    }
    setBusyAction("automation");
    try {
      const next = await api.deleteAutomation(automationId);
      applySnapshot(next);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot]);

  const setAutomationEnabled = useCallback(async (automationId: string, enabled: boolean) => {
    if (!api) {
      return;
    }
    setBusyAction("automation");
    try {
      const next = await api.setAutomationEnabled(automationId, enabled);
      applySnapshot(next);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot]);

  const bootstrap = useCallback(async (request?: BootstrapRequest) => {
    if (!api) {
      return;
    }

    setBusyAction("bootstrap");
    try {
      const next = await api.bootstrap(request);
      applySnapshot(next);
      restoreSessionUi(next);
      setRuntimeError("");
      setWebHostPairingRequired(false);
      void refreshSessions();
    } catch (error) {
      setWebHostPairingRequired(errorCode(error) === "PAIRING_REQUIRED");
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions, restoreSessionUi]);

  const switchWorkspaceRoot = useCallback(
    async (workspaceRoot: string): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("bootstrap");
      try {
        stashSessionUi(snapshotRef.current);
        const next = await api.bootstrap({ workspaceRoot, workspaceBinding: 'project' });
        applySnapshot(next);
        restoreSessionUi(next);
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi],
  );

  const switchToNoWorkspaceBinding = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("bootstrap");
    try {
      stashSessionUi(snapshotRef.current);
      const next = await api.bootstrap({ workspaceBinding: 'none' });
      applySnapshot(next);
      restoreSessionUi(next);
      setQuestionError("");
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi]);

  const rememberWorkspaceRoot = useCallback(
    async (workspaceRoot: string): Promise<boolean> => {
      if (!api?.rememberWorkspaceRoot) {
        setRuntimeError(i18n.t('error.hostNotSupportAddWorkspace'));
        return false;
      }

      setBusyAction("bootstrap");
      try {
        const next = await api.rememberWorkspaceRoot({ workspaceRoot });
        applySnapshot(next);
        setRuntimeError("");
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const pickWorkspaceDirectory = useCallback(async (): Promise<string | null> => {
    if (!api?.pickWorkspaceDirectory) {
      setRuntimeError(i18n.t('error.hostNotSupportPickWorkspace'));
      return null;
    }

    try {
      return await api.pickWorkspaceDirectory();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const pickLocalFile = useCallback(async (): Promise<string | null> => {
    if (!api?.pickLocalFile) {
      setRuntimeError(i18n.t('error.hostNotSupportPickFile'));
      return null;
    }

    try {
      return await api.pickLocalFile();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const classifyLocalFileComposerRoute = useCallback(
    async (absolutePath: string): Promise<import('@spirit-agent/host-internal').LocalFileComposerRoute> => {
      if (!api) {
        return 'reference';
      }
      try {
        return await api.classifyLocalFileComposerRoute(absolutePath);
      } catch (error) {
        setRuntimeError(describeError(error));
        return 'reference';
      }
    },
    [api],
  );

  const getPathForDroppedFile = useCallback(
    (file: File): string | null => {
      if (!api?.getPathForDroppedFile) {
        return null;
      }
      try {
        const path = api.getPathForDroppedFile(file);
        return path.trim() ? path : null;
      } catch {
        return null;
      }
    },
    [api],
  );

  const ingestClipboardImage = useCallback(async (): Promise<string | null> => {
    if (!api?.ingestClipboardImage) {
      return null;
    }

    try {
      return await api.ingestClipboardImage();
    } catch (error) {
      setRuntimeError(describeError(error));
      return null;
    }
  }, [api]);

  const readLocalImagePreviewDataUrl = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (!api?.readLocalImagePreviewDataUrl) {
        return null;
      }

      try {
        return await api.readLocalImagePreviewDataUrl(filePath);
      } catch {
        return null;
      }
    },
    [api],
  );

  const readManagedImagePreviewDataUrl = useCallback(
    async (reference: string): Promise<string | null> => {
      if (!api?.readManagedImagePreviewDataUrl) {
        return null;
      }

      try {
        return await api.readManagedImagePreviewDataUrl(reference);
      } catch {
        return null;
      }
    },
    [api],
  );

  const saveLocalImageAs = useCallback(
    async (filePath: string): Promise<boolean> => {
      if (!api?.saveLocalImageAs) {
        setRuntimeError(i18n.t('error.hostNotSupportSaveImage'));
        return false;
      }

      try {
        return await api.saveLocalImageAs(filePath);
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      }
    },
    [api],
  );

  const readLocalVideoPreviewUrl = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (!api?.readLocalVideoPreviewUrl) {
        return null;
      }

      try {
        return await api.readLocalVideoPreviewUrl(filePath);
      } catch {
        return null;
      }
    },
    [api],
  );

  const readManagedVideoPreviewUrl = useCallback(
    async (reference: string): Promise<string | null> => {
      if (!api?.readManagedVideoPreviewUrl) {
        return null;
      }

      try {
        return await api.readManagedVideoPreviewUrl(reference);
      } catch {
        return null;
      }
    },
    [api],
  );

  const commitChanges = useCallback(
    async (request: CommitChangesRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("git");
      try {
        const next = await api.commitChanges(request);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const pairWebHost = useCallback(
    async (code: string): Promise<boolean> => {
      if (!api?.pairWebHost) {
        setRuntimeError(i18n.t('error.hostNotSupportWebPair'));
        return false;
      }

      setBusyAction("bootstrap");
      try {
        await api.pairWebHost(code);
        setWebHostPairingRequired(false);
        setRuntimeError("");
        await bootstrap();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, bootstrap],
  );

  useEffect(() => {
    if (api && hostReady) {
      void refreshSessions();
    }
  }, [api, hostReady, refreshSessions]);

  useEffect(() => {
    if (!api || snapshot) {
      return;
    }

    void bootstrap();
  }, [api, bootstrap, snapshot]);

  const pendingQuestions = snapshot?.conversation.pendingQuestions ?? null;

  useEffect(() => {
    if (!pendingQuestions) {
      setQuestionError("");
      setQuestionDrafts({});
      return;
    }

    setQuestionError("");
    setQuestionDrafts((current) => {
      const next: Record<string, QuestionDraft> = {};
      for (const question of pendingQuestions.request.questions) {
        next[question.id] = current[question.id] ?? emptyQuestionDraft();
      }
      return next;
    });
  }, [pendingQuestions]);

  const backgroundSessionsBusy = sessions.some((session) => session.isBusy === true);

  /** Active or background session busy: poll until none are busy. */
  useEffect(() => {
    const shouldPoll = snapshot?.conversation.isBusy === true || backgroundSessionsBusy;
    if (!api || !shouldPoll) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        while (!cancelled) {
          const next = await api.poll();
          if (cancelled) {
            break;
          }
          applySnapshot(next);
          if (next.conversation.isBusy === true) {
            continue;
          }
          const sessionItems = await api.listSessions();
          if (cancelled) {
            break;
          }
          applySessionList(sessionItems);
          const stillBusy = sessionItems.some((session) => session.isBusy === true);
          if (!stillBusy) {
            break;
          }
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(describeError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, applySessionList, applySnapshot, backgroundSessionsBusy, snapshot?.conversation.isBusy]);

  useEffect(() => {
    if (!api?.subscribeDreamUpdates) {
      return;
    }

    return api.subscribeDreamUpdates((next) => {
      const previous = snapshotRef.current;
      const needRefreshSessions = previous ? shouldRefreshDreamSessions(previous, next) : false;
      applySnapshot(next);
      if (needRefreshSessions) {
        void refreshSessions();
      }
    });
  }, [api, applySnapshot, refreshSessions]);

  useEffect(() => {
    if (!api?.subscribeAutomationsUpdates) {
      return;
    }

    return api.subscribeAutomationsUpdates((next) => {
      applySnapshot(next);
      void refreshSessions();
    });
  }, [api, applySnapshot, refreshSessions]);

  useEffect(() => {
    if (!api?.subscribeSessionListUpdates) {
      return;
    }

    return api.subscribeSessionListUpdates(() => {
      void refreshSessions();
    });
  }, [api, refreshSessions]);

  useEffect(() => {
    if (!api || !snapshot || snapshot.conversation.isBusy || !snapshot.dreams.settings.enabled) {
      return;
    }
    if (api.subscribeDreamUpdates) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pollDreams = async () => {
      try {
        const next = await api.poll();
        if (cancelled) {
          return;
        }
        const needRefreshSessions = shouldRefreshDreamSessions(snapshot, next);
        applySnapshot(next);
        if (needRefreshSessions) {
          void refreshSessions();
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(describeError(error));
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollDreams, DREAM_IDLE_POLL_INTERVAL_MS);
        }
      }
    };

    timer = setTimeout(pollDreams, DREAM_IDLE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [api, applySnapshot, refreshSessions, snapshot]);

  useEffect(() => {
    if (!api?.refreshGitSnapshot) {
      return;
    }
    if (!snapshot || snapshot.workspaceBinding !== 'project' || !snapshot.git.isRepository) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      if (inFlight) {
        timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        return;
      }

      inFlight = true;
      try {
        const next = await api.refreshGitSnapshot();
        if (!cancelled) {
          applySnapshot(next);
        }
      } catch {
        // 后台轮询失败不打断主流程；用户操作触发的 Git API 仍会 surfacing 错误。
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);
        }
      }
    };

    timer = setTimeout(tick, GIT_STATE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    api,
    applySnapshot,
    snapshot?.workspaceBinding,
    snapshot?.git.isRepository,
    snapshot?.workspaceRoot,
  ]);

  const updateQuestionDraft = useCallback(
    (questionId: string, updater: (draft: QuestionDraft) => QuestionDraft) => {
      setQuestionError("");
      setQuestionDrafts((current) => ({
        ...current,
        [questionId]: updater(current[questionId] ?? emptyQuestionDraft()),
      }));
    },
    [],
  );

  const setActiveModel = useCallback(
    (name: string) => {
      if (!snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) => item.name === name);
      const current = settingsRef.current;
      const next: typeof settings = {
        ...current,
        activeModel: name,
        apiBase: model?.apiBase ?? current.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      if (!api) {
        return;
      }

      void (async () => {
        try {
          const res = await api.updateConfig(
            updateConfigFromSettingsForm(next, {
              enabled: next.webHostEnabled,
              host: next.webHostHost,
              port: next.webHostPort,
            }),
          );
          applySnapshot(res);
          setRuntimeError("");
          setSettings((c) => ({ ...c, apiKey: "" }));
        } catch (error) {
          setRuntimeError(describeError(error));
        }
      })();
    },
    [api, applySnapshot, snapshot],
  );

  const addModel = useCallback(
    async (request: AddModelRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.addModel(request);
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const addProviderModels = useCallback(
    async (request: AddProviderModelsRequest) => {
      if (!api) {
        return;
      }
      setBusyAction("models");
      try {
        const next = await api.addProviderModels(request);
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const previewModels = useCallback(
    async (request: PreviewModelsRequest): Promise<PreviewModelsResponse> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      setBusyAction("modelsPreview");
      try {
        setRuntimeError("");
        return await api.previewModels(request);
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const removeModel = useCallback(
    async (name: string) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.removeModel(name);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const removeProviderModels = useCallback(
    async (provider: DesktopModelProvider) => {
      if (!api) {
        return;
      }

      setBusyAction("models");
      try {
        const next = await api.removeProviderModels(provider);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const createSkill = useCallback(
    async (request: CreateSkillRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("skills");
      try {
        const next = await api.createSkill(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteSkill = useCallback(
    async (request: DeleteSkillRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("skills");
      try {
        const next = await api.deleteSkill(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const createRule = useCallback(
    async (request: CreateRuleRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("rules");
      try {
        const next = await api.createRule(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteRule = useCallback(
    async (request: DeleteRuleRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("rules");
      try {
        const next = await api.deleteRule(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const addMcpServer = useCallback(
    async (request: AddMcpServerRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("mcps");
      try {
        const next = await api.addMcpServer(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteMcpServer = useCallback(
    async (request: DeleteMcpServerRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("mcps");
      try {
        const next = await api.deleteMcpServer(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const saveHookEntry = useCallback(
    async (request: SaveHookEntryRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("hooks");
      try {
        const next = await api.saveHookEntry(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteHookEntry = useCallback(
    async (request: DeleteHookEntryRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("hooks");
      try {
        const next = await api.deleteHookEntry(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const inspectMcpServer = useCallback(
    async (name: string): Promise<DesktopMcpServerInspection> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.inspectMcpServer(name);
    },
    [api],
  );

  const importExtension = useCallback(
    async (request: ImportExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.importExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const listMarketplaceExtensions = useCallback(
    async (): Promise<DesktopMarketplaceCatalogItem[]> => {
      if (!api) {
        return [];
      }

      setBusyAction("marketplace");
      try {
        const items = await api.listMarketplaceExtensions();
        setRuntimeError("");
        return items;
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const getMarketplaceExtensionDetail = useCallback(
    async (extensionId: string): Promise<DesktopMarketplaceDetail> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }

      setBusyAction("marketplace");
      try {
        const detail = await api.getMarketplaceExtensionDetail(extensionId);
        setRuntimeError("");
        return detail;
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const getMarketplaceExtensionReadme = useCallback(
    async (extensionId: string): Promise<string> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }

      setBusyAction("marketplace");
      try {
        const readme = await api.getMarketplaceExtensionReadme(extensionId);
        setRuntimeError("");
        return readme;
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const prepareMarketplaceExtensionInstall = useCallback(
    async (
      request: PrepareMarketplaceExtensionInstallRequest,
    ): Promise<DesktopMarketplacePreparedInstall> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }

      setBusyAction("marketplace");
      try {
        const prepared = await api.prepareMarketplaceExtensionInstall(request);
        setRuntimeError("");
        return prepared;
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api],
  );

  const installMarketplaceExtension = useCallback(
    async (request: InstallMarketplaceExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("marketplace");
      try {
        const next = await api.installMarketplaceExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const deleteExtension = useCallback(
    async (request: DeleteExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.deleteExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const runExtension = useCallback(
    async (request: RunExtensionRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.runExtension(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateExtensionSettings = useCallback(
    async (request: UpdateExtensionSettingsRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.updateExtensionSettings(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const updateExtensionSecret = useCallback(
    async (request: UpdateExtensionSecretRequest) => {
      if (!api) {
        return;
      }

      setBusyAction("extensions");
      try {
        const next = await api.updateExtensionSecret(request);
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        const message = describeError(error);
        setRuntimeError(message);
        throw new Error(message);
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  const saveSettingsPatch = useCallback(
    async (patch: Partial<SettingsFormState>) => {
      if (!api) {
        return;
      }

      const micaPatch = patch.windowsMica !== undefined;
      let micaSeq = 0;
      if (micaPatch) {
        micaSaveSeqRef.current += 1;
        micaSeq = micaSaveSeqRef.current;
        micaInFlightRef.current += 1;
      }

      const prev = settingsRef.current;
      const nextActiveModel = patch.activeModel ?? prev.activeModel;
      const resolvedApiBase =
        patch.apiBase ??
        (patch.activeModel !== undefined
          ? snapshotRef.current?.config.models.find((model) => model.name === nextActiveModel)?.apiBase ??
            prev.apiBase
          : prev.apiBase);
      const s = {
        ...prev,
        ...patch,
        activeModel: nextActiveModel,
        apiBase: resolvedApiBase,
      };
      const webHostEndpointChanged =
        s.webHostHost !== prev.webHostHost || s.webHostPort !== prev.webHostPort;
      settingsRef.current = s;
      setSettings(s);
      try {
        const next = await api.updateConfig(
          updateConfigFromSettingsForm(s, {
            enabled: s.webHostEnabled,
            host: s.webHostHost,
            port: s.webHostPort,
            ...(webHostEndpointChanged ? { resetPairing: true } : {}),
          }),
        );
        const staleWindowsMicaSave = micaPatch && micaSeq < micaSaveSeqRef.current;
        if (!staleWindowsMicaSave) {
          applySnapshot(next);
        }
        setRuntimeError("");
        setSettings((current) => ({
          ...current,
          apiKey: "",
        }));
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        if (micaPatch) {
          micaInFlightRef.current -= 1;
        }
      }
    },
    [api, applySnapshot],
  );

  const setModelReasoningEffort = useCallback(
    async (name: string, reasoningEffort: DesktopModelReasoningEffort) => {
      if (!api || !snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) => item.name === name);
      if (!model) {
        return;
      }

      const next = {
        ...settingsRef.current,
        activeModel: model.name,
        apiBase: model.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      try {
        const res = await api.updateConfig({
          ...updateConfigFromSettingsForm(next, {
            enabled: next.webHostEnabled,
            host: next.webHostHost,
            port: next.webHostPort,
          }),
          reasoningEffort,
        });
        applySnapshot(res);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        setRuntimeError(describeError(error));
      }
    },
    [api, applySnapshot, snapshot],
  );

  const setModelThinkingEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      if (!api || !snapshot) {
        return;
      }

      const model = snapshot.config.models.find((item) => item.name === name);
      if (!model) {
        return;
      }

      const next = {
        ...settingsRef.current,
        activeModel: model.name,
        apiBase: model.apiBase,
      };
      settingsRef.current = next;
      setSettings(next);

      const optimisticModels = snapshot.config.models.map((item) => {
        if (item.name !== name) {
          return item;
        }
        if (enabled) {
          const { thinkingEnabled: _removed, ...rest } = item;
          return rest;
        }
        return { ...item, thinkingEnabled: false as const };
      });
      applySnapshot({
        ...snapshot,
        config: {
          ...snapshot.config,
          activeModel: model.name,
          models: optimisticModels,
        },
      });

      try {
        const res = await api.updateConfig({
          ...updateConfigFromSettingsForm(next, {
            enabled: next.webHostEnabled,
            host: next.webHostHost,
            port: next.webHostPort,
          }),
          thinkingEnabled: enabled,
        });
        applySnapshot(res);
        setRuntimeError("");
        setSettings((current) => ({ ...current, apiKey: "" }));
      } catch (error) {
        applySnapshot(snapshot);
        setRuntimeError(describeError(error));
      }
    },
    [api, applySnapshot, snapshot],
  );

  const resetWebHostPairing = useCallback(async () => {
    if (!api) {
      return;
    }

    const s = settingsRef.current;
    try {
      const next = await api.updateConfig(
        updateConfigFromSettingsForm(s, {
          enabled: s.webHostEnabled,
          host: s.webHostHost,
          port: s.webHostPort,
          resetPairing: true,
        }),
      );
      applySnapshot(next);
      setRuntimeError("");
      setSettings((current) => ({
        ...current,
        apiKey: "",
      }));
    } catch (error) {
      setRuntimeError(describeError(error));
    }
  }, [api, applySnapshot]);

  const sendMessage = useCallback(async (request: SubmitUserTurnRequest = { text: composer }) => {
    if (!api) {
      return false;
    }

    const localFilePaths = request.localFilePaths ?? [];
    const hasLocalFiles = localFilePaths.length > 0;
    const text = request.text.trim();
    if (!text && !hasLocalFiles) {
      return false;
    }
    if (isLogSessionSlashInput(text)) {
      if (hasLocalFiles) {
        setRuntimeError(i18n.t('error.attachmentsNotSupportedWithSlash'));
        return false;
      }
      if (!api.exportSessionLog) {
        setRuntimeError(i18n.t('error.hostNotSupportLogSession'));
        return false;
      }

      setBusyAction("send");
      try {
        const next = await api.exportSessionLog();
        applySnapshot(next);
        clearActiveComposerDraft();
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    }
    if (isCompactSlashInput(text)) {
      if (hasLocalFiles) {
        setRuntimeError(i18n.t('error.attachmentsNotSupportedWithSlash'));
        return false;
      }

      setBusyAction("send");
      try {
        const next = await api.compactHistory();
        applySnapshot(next);
        clearActiveComposerDraft();
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    }
    if (snapshot?.activeSession?.readOnly) {
      setRuntimeError(i18n.t('error.readonlySessionSend'));
      return false;
    }

    const canEnqueueWhileBusy =
      snapshot?.conversation.isBusy === true &&
      !snapshot.conversation.pendingToolApproval &&
      !snapshot.conversation.pendingQuestions;
    if (snapshot?.conversation.isBusy && !canEnqueueWhileBusy) {
      setRuntimeError(i18n.t('error.pendingApprovalSend'));
      return false;
    }

    setBusyAction("send");
    try {
      const skillSlash = snapshot ? matchSkillSlashInput(text, snapshot.skillsList) : undefined;
      if (hasLocalFiles && (isCompactSlashInput(text) || skillSlash)) {
        setRuntimeError(i18n.t('error.attachmentsNotSupportedWithSlash'));
        return false;
      }
      const next = skillSlash
        ? await api.submitSkillSlash({
            skillName: skillSlash.skillName,
            rawText: text,
            ...(skillSlash.extraNote ? { extraNote: skillSlash.extraNote } : {}),
          })
        : await api.submitUserTurn({
            text: request.text,
            ...(hasLocalFiles ? { localFilePaths } : {}),
          });
      applySnapshot(next);
      clearActiveComposerDraft();
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, clearActiveComposerDraft, composer, refreshSessions, snapshot]);

  const submitGitChip = useCallback(
    async (request: SubmitGitChipRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      try {
        setBusyAction("send");
        const next = await api.submitGitChip(request);
        applySnapshot(next);
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const submitStartImplementing = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      // Host switches to agent before the turn; exit chip mode locally so applySnapshot
      // turn-in-flight / chip-preserve guards do not keep plan across the busy window.
      agentModeChipDismissedRef.current = true;
      setAgentModeChipDismissed(true);
      const prevSettings = settingsRef.current;
      const agentSettings = { ...prevSettings, agentMode: "agent" as DesktopAgentMode };
      settingsRef.current = agentSettings;
      setSettings(agentSettings);
      setBusyAction("send");
      const next = await api.submitStartImplementing();
      applySnapshot(next);
      clearActiveComposerDraft();
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, clearActiveComposerDraft, refreshSessions]);

  const abortConversation = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      const next = await api.abortConversation();
      applySnapshot(next);
      setRuntimeError("");
      if (!next.conversation.isBusy) {
        void refreshSessions();
      }
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot, refreshSessions]);

  const abortShell = useCallback(async (toolCallId: string): Promise<boolean> => {
    if (!api?.abortShell) {
      return false;
    }

    const trimmed = toolCallId.trim();
    if (!trimmed) {
      return false;
    }

    try {
      const next = await api.abortShell(trimmed);
      applySnapshot(next);
      setRuntimeError("");
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot]);

  const setLoopEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      const next = await api.setLoopEnabled(enabled);
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot, refreshSessions]);

  const setSubagentViewerTarget = useCallback(async (parentToolCallId: string | null): Promise<boolean> => {
    if (!api?.setSubagentViewerTarget) {
      return false;
    }

    try {
      const next = await api.setSubagentViewerTarget(parentToolCallId);
      applySnapshot(next);
      setRuntimeError("");
      if (!parentToolCallId?.trim()) {
        return true;
      }
      const trimmed = parentToolCallId.trim();
      return Boolean(next.subagentViewer)
        || isRunSubagentToolCallPending(next.conversation.messages, trimmed);
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot]);

  const setApprovalLevel = useCallback(async (approvalLevel: import('@spirit-agent/host-internal').ApprovalLevel): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      const next = await api.setApprovalLevel(approvalLevel);
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot, refreshSessions]);

  const setPendingGitBranch = useCallback(async (branch: string): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      const next = await api.setPendingGitBranch(branch);
      applySnapshot(next);
      setRuntimeError("");
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot]);

  const setWorkLocation = useCallback(async (
    workLocation: import('@spirit-agent/host-internal').WorkLocationKind,
  ): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
      const next = await api.setWorkLocation(workLocation);
      applySnapshot(next);
      setRuntimeError("");
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    }
  }, [api, applySnapshot]);

  const checkoutGitBranch = useCallback(async (
    branch: string,
    options?: { discardLocalChanges?: boolean },
  ): Promise<CheckoutGitBranchResult> => {
    if (!api) {
      return { ok: false, reason: "error" };
    }

    setBusyAction("git");
    try {
      const next = await api.checkoutGitBranch({
        branch,
        discardLocalChanges: options?.discardLocalChanges === true,
      });
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return { ok: true };
    } catch (error) {
      if (isCheckoutBlockedByLocalChanges(error)) {
        return { ok: false, reason: "local-changes" };
      }
      setRuntimeError(sanitizeGitErrorMessage(error));
      return { ok: false, reason: "error" };
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const mergeWorktreeToMain = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("git");
    try {
      const next = await api.mergeWorktreeToMain();
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(sanitizeGitErrorMessage(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const pushGitBranch = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    setBusyAction("git");
    try {
      const next = await api.pushGitBranch();
      applySnapshot(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(sanitizeGitErrorMessage(error));
      return false;
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const continueAssistantCompletion = useCallback(
    async (messageId: number): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("continue");
      try {
        const next = await api.continueAssistantCompletion(messageId);
        applySnapshot(next);
        setRuntimeError("");
        if (!next.conversation.isBusy) {
          void refreshSessions();
        }
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );
  
  const reorderQueuedUserTurn = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction('send');
      try {
        const next = await api.reorderQueuedUserTurn({ queueId });
        applySnapshot(next);
        setRuntimeError('');
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction('');
      }
    },
    [api, applySnapshot],
  );

  const sendQueuedUserTurnNow = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction('send');
      try {
        const next = await api.sendQueuedUserTurnNow({ queueId });
        applySnapshot(next);
        setRuntimeError('');
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction('');
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const removeQueuedUserTurn = useCallback(
    async (queueId: string): Promise<boolean> => {
      if (!api) {
        return false;
      }
      setBusyAction('send');
      try {
        const next = await api.removeQueuedUserTurn({ queueId });
        applySnapshot(next);
        setRuntimeError('');
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction('');
      }
    },
    [api, applySnapshot],
  );

  const rewindAndSubmitMessage = useCallback(
    async (request: RewindAndSubmitMessageRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("rewind");
      try {
        const next = await api.rewindAndSubmitMessage(request);
        applySnapshot(next);
        clearActiveComposerDraft();
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, clearActiveComposerDraft, refreshSessions],
  );

  const forkSession = useCallback(
    async (request: ForkSessionRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("fork");
      try {
        const next = await api.forkSession(request);
        applySnapshot(next);
        clearActiveComposerDraft();
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
        return true;
      } catch (error) {
        setRuntimeError(describeError(error));
        return false;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, clearActiveComposerDraft, refreshSessions],
  );

  const submitApproval = useCallback(async (decision: DesktopApprovalDecision) => {
    if (!api) {
      return;
    }

    if (decision.kind === "guidance" && !decision.userMessage.trim()) {
      setRuntimeError(i18n.t('error.enterGuidance'));
      return;
    }

    setBusyAction("approve");
    try {
      const next = await api.replyPendingApproval(decision);
      applySnapshot(next);
      setApprovalGuidance("");
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeApprovalFromNotification) {
      return;
    }
    return bridge.subscribeApprovalFromNotification(({ decision }) => {
      void submitApproval({ kind: decision });
    });
  }, [submitApproval]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeNotificationReply) {
      return;
    }
    return bridge.subscribeNotificationReply((payload) => {
      if (payload.kind !== 'approval') {
        return;
      }
      const current = snapshotRef.current?.conversation.pendingToolApproval;
      const userMessage = payload.text.trim();
      if (!current || !userMessage) {
        return;
      }
      void submitApproval({ kind: 'guidance', userMessage });
    });
  }, [submitApproval]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!api || !bridge?.subscribeNotificationReply) {
      return;
    }
    return bridge.subscribeNotificationReply((payload) => {
      if (payload.kind !== 'ask-questions') {
        return;
      }
      const result = buildSingleTextQuestionNotificationReplyResult(
        snapshotRef.current?.conversation.pendingQuestions,
        payload,
      );
      if (!result) {
        return;
      }
      void (async () => {
        setBusyAction('questions');
        try {
          const next = await api.replyPendingQuestions(result);
          applySnapshot(next);
          setQuestionError('');
          setRuntimeError('');
        } catch (error) {
          setRuntimeError(describeError(error));
        } finally {
          setBusyAction('');
        }
      })();
    });
  }, [api, applySnapshot]);

  const submitQuestions = useCallback(async () => {
    if (!api || !pendingQuestions) {
      return;
    }

    const built = buildAskQuestionsResult(pendingQuestions.request, questionDrafts);
    if (!built.result) {
      setQuestionError(built.error ?? i18n.t('error.completeQuestionnaire'));
      return;
    }

    setBusyAction("questions");
    try {
      const next = await api.replyPendingQuestions(built.result);
      applySnapshot(next);
      setQuestionError("");
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, pendingQuestions, questionDrafts]);

  const skipQuestions = useCallback(async () => {
    if (!api || !pendingQuestions) {
      return;
    }

    setBusyAction("questions");
    try {
      const next = await api.replyPendingQuestions({
        status: "skipped",
      });
      applySnapshot(next);
      setQuestionError("");
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, pendingQuestions]);

  const openSession = useCallback(
    async (path: string) => {
      if (!api) {
        return;
      }
      acknowledgeSessionAttention(path);
      const navGeneration = sessionNavigationGenerationRef.current + 1;
      sessionNavigationGenerationRef.current = navGeneration;
      setBusyAction("session");
      try {
        stashSessionUi(snapshotRef.current);
        const next = await api.openSession(path);
        if (navGeneration !== sessionNavigationGenerationRef.current) {
          return;
        }
        applySnapshot(next, { navGeneration });
        restoreSessionUi(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        if (navGeneration === sessionNavigationGenerationRef.current) {
          setBusyAction("");
        }
      }
    },
    [acknowledgeSessionAttention, api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi],
  );

  const deleteSession = useCallback(
    async (path: string) => {
      if (!api) {
        return;
      }
      acknowledgeSessionAttention(path);
      const navGeneration = sessionNavigationGenerationRef.current + 1;
      sessionNavigationGenerationRef.current = navGeneration;
      setBusyAction("session");
      try {
        const next = await api.deleteSession(path);
        if (navGeneration !== sessionNavigationGenerationRef.current) {
          return;
        }
        applySnapshot(next, { navGeneration });
        restoreSessionUi(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        if (navGeneration === sessionNavigationGenerationRef.current) {
          setBusyAction("");
        }
      }
    },
    [acknowledgeSessionAttention, api, applySnapshot, refreshSessions, restoreSessionUi],
  );

  const deleteWorkspace = useCallback(
    async (workspacePath: string) => {
      if (!api?.forgetWorkspace) {
        return;
      }
      const normalizedTarget = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const workspaceSessions = sessions.filter((s) => {
        const rawRoot = (s.workspaceRoot ?? "").trim();
        if (!rawRoot) {
          return false;
        }
        const groupingRoot = resolveWorkspaceGroupingRoot(rawRoot)
          .replace(/\\/g, "/")
          .replace(/\/+$/, "")
          .toLowerCase();
        return groupingRoot === normalizedTarget;
      });
      setBusyAction("session");
      try {
        for (const session of workspaceSessions) {
          acknowledgeSessionAttention(session.path);
          await api.deleteSession(session.path);
        }
        const next = await api.forgetWorkspace({ workspaceRoot: workspacePath });
        applySnapshot(next);
        restoreSessionUi(next);
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [acknowledgeSessionAttention, api, applySnapshot, refreshSessions, restoreSessionUi, sessions],
  );

  const listWorkspaceFileReferenceSuggestions = useCallback(
    async (
      request: QueryWorkspaceFileReferenceSuggestionsRequest,
    ): Promise<WorkspaceFileReferenceSuggestionsResponse> => {
      if (!api) {
        return null;
      }
      return api.listWorkspaceFileReferenceSuggestions(request);
    },
    [api],
  );

  const primeWorkspaceFileReferenceIndex = useCallback(async (): Promise<void> => {
    if (!api) {
      return;
    }
    await api.primeWorkspaceFileReferenceIndex();
  }, [api]);

  const getWorkspaceFileReferenceIndex = useCallback(async () => {
    if (!api) {
      return { ready: false, files: [] };
    }
    return api.getWorkspaceFileReferenceIndex();
  }, [api]);

  const listWorkspaceExplorerChildren = useCallback(
    async (relativePath: string): Promise<WorkspaceExplorerListResult> => {
      if (!api) {
        return { entries: [] };
      }
      return api.listWorkspaceExplorerChildren(relativePath);
    },
    [api],
  );

  const readGitWorkingTree = useCallback(async (): Promise<GitWorkingTreeSnapshot> => {
    if (!api) {
      return { isRepository: false, changes: [] };
    }
    return api.readGitWorkingTree();
  }, [api]);

  const readGitHistory = useCallback(
    async (request: ReadGitHistoryRequest = {}): Promise<GitHistorySnapshot> => {
      if (!api) {
        return { isRepository: false, commits: [], rows: [], hasMore: false, logCommits: [] };
      }
      return api.readGitHistory(request);
    },
    [api],
  );

  const readGitCommitMessage = useCallback(
    async (request: ReadGitCommitMessageRequest): Promise<GitCommitMessageSnapshot> => {
      if (!api) {
        return {
          isRepository: false,
          oid: '',
          subject: '',
          author: '',
          authoredAt: '',
          fullMessage: '',
        };
      }
      return api.readGitCommitMessage(request);
    },
    [api],
  );

  const getGitHubAuthStatus = useCallback(async () => {
    if (!api) {
      return { connected: false };
    }
    return api.getGitHubAuthStatus();
  }, [api]);

  const beginGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      throw new Error(i18n.t('error.hostNotReady'));
    }
    return api.beginGitHubDeviceLogin();
  }, [api]);

  const completeGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      throw new Error(i18n.t('error.hostNotReady'));
    }
    return api.completeGitHubDeviceLogin();
  }, [api]);

  const cancelGitHubDeviceLogin = useCallback(async () => {
    if (!api) {
      return;
    }
    await api.cancelGitHubDeviceLogin();
  }, [api]);

  const disconnectGitHub = useCallback(async () => {
    if (!api) {
      return { connected: false };
    }
    const status = await api.disconnectGitHub();
    clearGitHubAutomationRepositoriesCache();
    return status;
  }, [api]);

  const getGitHubPullRequestForCurrentBranch = useCallback(async () => {
    if (!api) {
      return { repository: null, branch: null, pullRequest: null };
    }
    return api.getGitHubPullRequestForCurrentBranch();
  }, [api]);

  const getGitHubPullRequestDetail = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.getGitHubPullRequestDetail(request);
    },
    [api],
  );

  const getGitHubPullRequestConversation = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.getGitHubPullRequestConversation(request);
    },
    [api],
  );

  const getGitHubPullRequestFiles = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.getGitHubPullRequestFiles(request);
    },
    [api],
  );

  const getGitHubPullRequestCommits = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.getGitHubPullRequestCommits(request);
    },
    [api],
  );

  const getGitHubPullRequestChecks = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.getGitHubPullRequestChecks(request);
    },
    [api],
  );

  const mergeGitHubPullRequest = useCallback(
    async (request: MergeGitHubPullRequestRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.mergeGitHubPullRequest(request);
    },
    [api],
  );

  const markGitHubPullRequestReady = useCallback(
    async (request: GetGitHubPullRequestDetailRequest) => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.markGitHubPullRequestReady(request);
    },
    [api],
  );

  const listGitHubPullRequests = useCallback(
    async (request: ListGitHubPullRequestsRequest) => {
      if (!api) {
        return { items: [], totalCount: 0, hasMore: false };
      }
      return api.listGitHubPullRequests(request);
    },
    [api],
  );

  const listGitHubAutomationRepositories = useCallback(
    async (page?: number) => {
      if (!api) {
        return { items: [], hasNextPage: false };
      }
      return api.listGitHubAutomationRepositories(page !== undefined ? { page } : {});
    },
    [api],
  );

  const searchGitHubAutomationRepositories = useCallback(
    async (query: string, page?: number) => {
      if (!api) {
        return { items: [], totalCount: 0 };
      }
      return api.searchGitHubAutomationRepositories({ query, ...(page ? { page } : {}) });
    },
    [api],
  );

  const getGitHubPullRequestTabCounts = useCallback(
    async (request: GetGitHubPullRequestTabCountsRequest) => {
      if (!api) {
        return { open: 0, closed: 0 };
      }
      return api.getGitHubPullRequestTabCounts(request);
    },
    [api],
  );

  const readWorkspaceTextFile = useCallback(
    async (
      relativePath: string,
      options?: import('@/types').ReadWorkspaceTextFileOptions,
    ): Promise<WorkspaceReadTextFileResult> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.readWorkspaceTextFile(relativePath, options);
    },
    [api],
  );

  const searchWorkspaceContent = useCallback(
    async (
      request: import('@/types').WorkspaceContentSearchRequest,
    ): Promise<import('@/types').WorkspaceContentSearchResult> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.searchWorkspaceContent(request);
    },
    [api],
  );

  const writeWorkspaceTextFile = useCallback(
    async (request: WriteWorkspaceTextFileRequest): Promise<void> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.writeWorkspaceTextFile(request);
    },
    [api],
  );

  const readHostTextFile = useCallback(
    async (absolutePath: string): Promise<WorkspaceReadTextFileResult> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.readHostTextFile(absolutePath);
    },
    [api],
  );

  const writeHostTextFile = useCallback(
    async (request: WriteHostTextFileRequest): Promise<void> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.writeHostTextFile(request);
    },
    [api],
  );

  const statHostTextFile = useCallback(
    async (absolutePath: string): Promise<HostTextFileStatResult> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.statHostTextFile(absolutePath);
    },
    [api],
  );

  const resetSession = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    const navGeneration = sessionNavigationGenerationRef.current + 1;
    sessionNavigationGenerationRef.current = navGeneration;
    setBusyAction("reset");
    try {
      stashSessionUi(snapshotRef.current);
      const next = await api.resetSession();
      if (navGeneration !== sessionNavigationGenerationRef.current) {
        return false;
      }
      applySnapshot(next, { navGeneration });
      restoreSessionUi(next);
      setRuntimeError("");
      void refreshSessions();
      return true;
    } catch (error) {
      setRuntimeError(describeError(error));
      return false;
    } finally {
      if (navGeneration === sessionNavigationGenerationRef.current) {
        setBusyAction("");
      }
    }
  }, [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi]);

  const summary = useMemo(() => {
    const canEnqueueWhileBusy =
      !!snapshot?.runtimeReady &&
      !!snapshot.conversation.isBusy &&
      !snapshot.conversation.pendingToolApproval &&
      !snapshot.conversation.pendingQuestions;
    return {
      canSend:
        !!snapshot?.runtimeReady &&
        !snapshot.conversation.isBusy &&
        !snapshot.conversation.pendingToolApproval &&
        !snapshot.conversation.pendingQuestions,
      canEnqueueWhileBusy,
      canInterrupt: canEnqueueWhileBusy,
      hostStatus: hostError
        ? hostError
        : hostReady
          ? kind === "electron"
            ? "Electron Desktop"
            : "localhost Web Host"
          : i18n.t('common.connectingHost'),
    };
  }, [hostError, hostReady, kind, snapshot]);

  const refreshFromHostPoll = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const next = await api.poll();
      applySnapshot(next);
      void refreshSessions();
    } catch {
      // ignore poll errors from notification refresh
    }
  }, [api, applySnapshot, refreshSessions]);

  useDesktopSystemNotifications({
    enabled: settings.systemNotifications,
    apiKind: kind,
    snapshot,
    sessions,
    onNotifyRefresh: refreshFromHostPoll,
  });

  const installLspProvider = useCallback(
    async (providerId: string) => {
      if (!api?.installLspProvider) {
        throw new Error("LSP provider install is only available in the desktop app.");
      }

      setBusyAction("lspInstall");
      try {
        const next = await api.installLspProvider({ providerId });
        applySnapshot(next);
        setRuntimeError("");
      } catch (error) {
        setRuntimeError(describeError(error));
        throw error;
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

  return {
    apiReady: hostReady,
    hostConnectionError: hostError,
    busyAction,
    agentModeChipDismissed,
    composer,
    composerLocalFileAttachments,
    hostKind: kind,
    pendingQuestions,
    questionDrafts,
    questionError,
    refreshSessions,
    listDreamsOverview,
    listAutomations,
    getAutomation,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    setAutomationEnabled,
    runtimeError,
    sessions,
    unseenCompletedSessionPaths,
    settings,
    snapshot,
    summary,
    webHostPairingRequired,
    approvalGuidance,
    setActiveModel,
    setModelReasoningEffort,
    setModelThinkingEnabled,
    setApprovalGuidance,
    setAgentModeChipDismissed,
    setComposer,
    setComposerLocalFileAttachments,
    setQuestionDrafts,
    setSettings,
    updateQuestionDraft,
    bootstrap,
    switchWorkspaceRoot,
    switchToNoWorkspaceBinding,
    rememberWorkspaceRoot,
    pickWorkspaceDirectory,
    pickLocalFile,
    getPathForDroppedFile,
    classifyLocalFileComposerRoute,
    ingestClipboardImage,
    readLocalImagePreviewDataUrl,
    readManagedImagePreviewDataUrl,
    readLocalVideoPreviewUrl,
    readManagedVideoPreviewUrl,
    saveLocalImageAs,
    commitChanges,
    submitGitChip,
    addModel,
    addProviderModels,
    previewModels,
    removeModel,
    removeProviderModels,
    addMcpServer,
    importExtension,
    listMarketplaceExtensions,
    getMarketplaceExtensionDetail,
    getMarketplaceExtensionReadme,
    prepareMarketplaceExtensionInstall,
    installMarketplaceExtension,
    createSkill,
    createRule,
    deleteExtension,
    runExtension,
    updateExtensionSettings,
    updateExtensionSecret,
    deleteMcpServer,
    saveHookEntry,
    deleteHookEntry,
    deleteSkill,
    deleteRule,
    inspectMcpServer,
    abortConversation,
    abortShell,
    setLoopEnabled,
    setSubagentViewerTarget,
    setApprovalLevel,
    setPendingGitBranch,
    setWorkLocation,
    checkoutGitBranch,
    mergeWorktreeToMain,
    pushGitBranch,
    continueAssistantCompletion,
    openSession,
    deleteSession,
    deleteWorkspace,
    listWorkspaceFileReferenceSuggestions,
    primeWorkspaceFileReferenceIndex,
    getWorkspaceFileReferenceIndex,
    listWorkspaceExplorerChildren,
    readGitWorkingTree,
    readGitHistory,
    readGitCommitMessage,
    getGitHubAuthStatus,
    beginGitHubDeviceLogin,
    completeGitHubDeviceLogin,
    cancelGitHubDeviceLogin,
    disconnectGitHub,
    getGitHubPullRequestForCurrentBranch,
    listGitHubPullRequests,
    listGitHubAutomationRepositories,
    searchGitHubAutomationRepositories,
    getGitHubPullRequestTabCounts,
    getGitHubPullRequestDetail,
    getGitHubPullRequestConversation,
    getGitHubPullRequestFiles,
    getGitHubPullRequestCommits,
    getGitHubPullRequestChecks,
    mergeGitHubPullRequest,
    markGitHubPullRequestReady,
    readWorkspaceTextFile,
    searchWorkspaceContent,
    writeWorkspaceTextFile,
    readHostTextFile,
    writeHostTextFile,
    statHostTextFile,
    pairWebHost,
    resetSession,
    rewindAndSubmitMessage,
    forkSession,
    reorderQueuedUserTurn,
    sendQueuedUserTurnNow,
    removeQueuedUserTurn,
    saveSettingsPatch,
    resetWebHostPairing,
    installLspProvider,
    lspInstallBusy: busyAction === "lspInstall",
    sendMessage,
    submitStartImplementing,
    skipQuestions,
    submitApproval,
    submitQuestions,
  };
}
