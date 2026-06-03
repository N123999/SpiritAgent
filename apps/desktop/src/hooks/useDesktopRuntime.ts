import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from '@/lib/i18n';

import type { SettingsFormState } from "@/components/settings-view";
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
  isCreateSkillSlashInput,
  isCompactSlashInput,
  isLogSessionSlashInput,
  matchSkillSlashInput,
} from "@/lib/skill-slash";
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
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteSkillRequest,
  DesktopApprovalDecision,
  DesktopModelReasoningEffort,
  DesktopDreamOverviewItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  PreviewModelsRequest,
  PreviewModelsResponse,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  SubmitUserTurnRequest,
  UpdateConfigRequest,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteWorkspaceTextFileRequest,
  DesktopModelProvider,
  GitHistorySnapshot,
  GitWorkingTreeSnapshot,
  ReadGitHistoryRequest,
} from "@/types";

type BusyAction =
  | ""
  | "bootstrap"
  | "send"
  | "continue"
  | "rewind"
  | "approve"
  | "questions"
  | "reset"
  | "session"
  | "models"
  | "modelsPreview"
  | "mcps"
  | "skills"
  | "extensions"
  | "marketplace"
  | "git";

const DREAM_IDLE_POLL_INTERVAL_MS = 30_000;
const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 400;

type SessionUiState = {
  composer: string;
  questionDrafts: Record<string, QuestionDraft>;
  localFilePaths: string[];
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
    apiBase: s.apiBase,
    windowsMica: s.windowsMica,
    planMode: s.planMode,
    webHost,
    dreams: {
      enabled: s.dreamEnabled,
      collectorModel: s.dreamCollectorModel,
      clearCollectorModel: !s.dreamCollectorModel.trim(),
      debugMode: s.dreamDebugMode,
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
  const [settings, setSettings] = useState({
    activeModel: "",
    imageGenerationModel: "",
    apiBase: "",
    uiLocale: "",
    apiKey: "",
    windowsMica: true,
    planMode: false,
    webHostEnabled: false,
    webHostHost: "127.0.0.1",
    webHostPort: 7788,
    dreamEnabled: false,
    dreamCollectorModel: "",
    dreamDebugMode: false,
  });
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [composerLocalFileAttachments, setComposerLocalFileAttachments] = useState<
    ComposerLocalFileAttachmentView[]
  >([]);
  const appliedConversationRevisionRef = useRef(0);
  const appliedComposerSessionKeyRef = useRef("");
  const sessionNavigationGenerationRef = useRef(0);
  const busyActionRef = useRef<BusyAction>("");
  const settingsRef = useRef(settings);
  const snapshotRef = useRef<DesktopSnapshot | null>(null);
  const sessionUiCacheRef = useRef(new Map<string, SessionUiState>());

  const sessionUiKey = useCallback((sessionKey: string | undefined) => sessionKey?.trim() || "", []);

  const clearActiveComposerDraft = useCallback(() => {
    const key = sessionUiKey(snapshotRef.current?.composerSessionKey);
    setComposer("");
    setComposerLocalFileAttachments([]);
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
      };
      sessionUiCacheRef.current.set(key, state);
      persistSessionUiDraft(key, state);
    },
    [composer, composerLocalFileAttachments, questionDrafts, sessionUiKey],
  );

  const restoreSessionUi = useCallback(
    (targetSnapshot: Pick<DesktopSnapshot, "composerSessionKey" | "activeSession"> | null | undefined) => {
      const snapshotLike = targetSnapshot ?? snapshotRef.current;
      if (snapshotLike?.activeSession?.readOnly) {
        setComposer("");
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setQuestionError("");
        return;
      }
      const key = sessionUiKey(snapshotLike?.composerSessionKey);
      if (!key) {
        setComposer("");
        setQuestionDrafts({});
        setComposerLocalFileAttachments([]);
        setQuestionError("");
        return;
      }
      const cached = sessionUiCacheRef.current.get(key);
      if (cached) {
        setComposer(cached.composer);
        setQuestionDrafts(cached.questionDrafts);
        setComposerLocalFileAttachments(attachmentsFromPaths(cached.localFilePaths));
        setQuestionError("");
        return;
      }
      const stored = readComposerDraft(key);
      setComposer(stored?.text ?? "");
      setQuestionDrafts({});
      setComposerLocalFileAttachments(attachmentsFromPaths(stored?.localFilePaths ?? []));
      setQuestionError("");
    },
    [sessionUiKey],
  );

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
      });
      persistSessionUiDraft(key, { composer, localFilePaths });
    }, COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [
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

      return {
        activeModel: next.config.activeModel,
        imageGenerationModel: next.config.imageGenerationModel ?? "",
        apiBase: activeModelProfile?.apiBase ?? current.apiBase,
        uiLocale: next.config.uiLocale ?? "",
        apiKey: current.apiKey,
        windowsMica: next.config.windowsMica !== false,
        planMode: next.config.planMode === true,
        webHostEnabled: next.webHost.config.enabled,
        webHostHost: next.webHost.config.host,
        webHostPort: next.webHost.config.port,
        dreamEnabled: next.dreams.settings.enabled,
        dreamCollectorModel: next.dreams.settings.collectorModel ?? "",
        dreamDebugMode: next.dreams.settings.debugMode,
      };
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      const list = await api.listSessions();
      setSessions(list);
    } catch {
      setSessions([]);
    }
  }, [api]);

  const listDreamsOverview = useCallback(async (): Promise<DesktopDreamOverviewItem[]> => {
    if (!api) {
      return [];
    }
    return api.listDreamsOverview();
  }, [api]);

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
          setSessions(sessionItems);
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
  }, [api, applySnapshot, backgroundSessionsBusy, snapshot?.conversation.isBusy]);

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
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({
          ...current,
          apiKey: "",
        }));
      } catch (error) {
        setRuntimeError(describeError(error));
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

    const interruptible =
      snapshot?.conversation.isBusy === true &&
      !snapshot.conversation.pendingToolApproval &&
      !snapshot.conversation.pendingQuestions;
    if (snapshot?.conversation.isBusy && !interruptible) {
      setRuntimeError(i18n.t('error.pendingApprovalSend'));
      return false;
    }

    setBusyAction("send");
    try {
      if (interruptible) {
        const aborted = await api.abortConversation();
        applySnapshot(aborted);
      }

      const skillSlash = snapshot ? matchSkillSlashInput(text, snapshot.skillsList) : undefined;
      if (
        hasLocalFiles &&
        (isCreateSkillSlashInput(text) ||
          isCompactSlashInput(text) ||
          skillSlash)
      ) {
        setRuntimeError(i18n.t('error.attachmentsNotSupportedWithSlash'));
        return false;
      }
      const next = isCreateSkillSlashInput(text)
        ? await api.submitCreateSkillSlash({
            rawText: text,
          })
        : skillSlash
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

  const submitStartImplementing = useCallback(async (): Promise<boolean> => {
    if (!api) {
      return false;
    }

    try {
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
    [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi],
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

  const readWorkspaceTextFile = useCallback(
    async (relativePath: string): Promise<WorkspaceReadTextFileResult> => {
      if (!api) {
        throw new Error(i18n.t('error.hostNotReady'));
      }
      return api.readWorkspaceTextFile(relativePath);
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

  const resetSession = useCallback(async () => {
    if (!api) {
      return;
    }

    const navGeneration = sessionNavigationGenerationRef.current + 1;
    sessionNavigationGenerationRef.current = navGeneration;
    setBusyAction("reset");
    try {
      stashSessionUi(snapshotRef.current);
      const next = await api.resetSession();
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
  }, [api, applySnapshot, refreshSessions, restoreSessionUi, stashSessionUi]);

  const summary = useMemo(() => {
    return {
      canSend:
        !!snapshot?.runtimeReady &&
        !snapshot.conversation.isBusy &&
        !snapshot.conversation.pendingToolApproval &&
        !snapshot.conversation.pendingQuestions,
      canInterrupt:
        !!snapshot?.runtimeReady &&
        !!snapshot.conversation.isBusy &&
        !snapshot.conversation.pendingToolApproval &&
        !snapshot.conversation.pendingQuestions,
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
    apiKind: kind,
    snapshot,
    sessions,
    onNotifyRefresh: refreshFromHostPoll,
  });

  return {
    apiReady: hostReady,
    hostConnectionError: hostError,
    busyAction,
    composer,
    composerLocalFileAttachments,
    hostKind: kind,
    pendingQuestions,
    questionDrafts,
    questionError,
    refreshSessions,
    listDreamsOverview,
    runtimeError,
    sessions,
    settings,
    snapshot,
    summary,
    webHostPairingRequired,
    approvalGuidance,
    setActiveModel,
    setModelReasoningEffort,
    setApprovalGuidance,
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
    ingestClipboardImage,
    readLocalImagePreviewDataUrl,
    readManagedImagePreviewDataUrl,
    saveLocalImageAs,
    commitChanges,
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
    deleteExtension,
    runExtension,
    updateExtensionSettings,
    updateExtensionSecret,
    deleteMcpServer,
    deleteSkill,
    inspectMcpServer,
    abortConversation,
    setLoopEnabled,
    setApprovalLevel,
    setPendingGitBranch,
    setWorkLocation,
    checkoutGitBranch,
    mergeWorktreeToMain,
    pushGitBranch,
    continueAssistantCompletion,
    openSession,
    listWorkspaceFileReferenceSuggestions,
    listWorkspaceExplorerChildren,
    readGitWorkingTree,
    readGitHistory,
    readWorkspaceTextFile,
    writeWorkspaceTextFile,
    pairWebHost,
    resetSession,
    rewindAndSubmitMessage,
    saveSettingsPatch,
    resetWebHostPairing,
    sendMessage,
    submitStartImplementing,
    skipQuestions,
    submitApproval,
    submitQuestions,
  };
}
