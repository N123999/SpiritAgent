import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SettingsFormState } from "@/components/settings-view";
import { useHostApi } from "@/hooks/useHostApi";
import { matchSkillSlashInput } from "@/lib/skill-slash";
import type {
  AddModelRequest,
  AskQuestionsAnswer,
  AskQuestionsQuestionSpec,
  AskQuestionsRequest,
  AskQuestionsResult,
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSnapshot,
  RewindAndSubmitMessageRequest,
  SessionListItem,
  UpdateConfigRequest,
} from "@/types";

type BusyAction =
  | ""
  | "bootstrap"
  | "send"
  | "rewind"
  | "approve"
  | "questions"
  | "reset"
  | "session"
  | "models"
  | "skills";

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
    apiBase: s.apiBase,
    windowsMica: s.windowsMica,
    planMode: s.planMode,
    webHost,
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
      error: `请先完成必答问题：${missingRequired.title}`,
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

export function useDesktopRuntime() {
  const { api, error: hostError, kind, ready: hostReady } = useHostApi();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [webHostPairingRequired, setWebHostPairingRequired] = useState(false);
  const [composer, setComposer] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("approve");
  const [questionError, setQuestionError] = useState("");
  const [settings, setSettings] = useState({
    activeModel: "",
    apiBase: "",
    uiLocale: "",
    apiKey: "",
    windowsMica: true,
    planMode: false,
    webHostEnabled: false,
    webHostHost: "127.0.0.1",
    webHostPort: 7788,
  });
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const applySnapshot = useCallback((next: DesktopSnapshot) => {
    setSnapshot(next);
    setRuntimeError(next.runtimeError ?? "");
    setSettings((current) => {
      const activeModelProfile = next.config.models.find(
        (model) => model.name === next.config.activeModel,
      );

      return {
        activeModel: next.config.activeModel,
        apiBase: activeModelProfile?.apiBase ?? current.apiBase,
        uiLocale: next.config.uiLocale ?? "",
        apiKey: current.apiKey,
        windowsMica: next.config.windowsMica !== false,
        planMode: next.config.planMode === true,
        webHostEnabled: next.webHost.config.enabled,
        webHostHost: next.webHost.config.host,
        webHostPort: next.webHost.config.port,
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

  const bootstrap = useCallback(async () => {
    if (!api) {
      return;
    }

    setBusyAction("bootstrap");
    try {
      const next = await api.bootstrap();
      applySnapshot(next);
      setRuntimeError("");
      setWebHostPairingRequired(false);
      void refreshSessions();
    } catch (error) {
      setWebHostPairingRequired(errorCode(error) === "PAIRING_REQUIRED");
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const pairWebHost = useCallback(
    async (code: string): Promise<boolean> => {
      if (!api?.pairWebHost) {
        setRuntimeError("当前宿主不支持 Web 配对。");
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

  /** `isBusy` 期间连续 poll 直至空闲，无固定间隔（便于观察流式与 IPC 真实性能）。 */
  useEffect(() => {
    if (!api || !snapshot?.conversation.isBusy) {
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
          if (!next.conversation.isBusy) {
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
  }, [api, applySnapshot, snapshot?.conversation.isBusy]);

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

  const saveSettingsPatch = useCallback(
    async (patch: Partial<SettingsFormState>) => {
      if (!api) {
        return;
      }

      const prev = settingsRef.current;
      const s = { ...prev, ...patch };
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

  const sendMessage = useCallback(async () => {
    if (!api) {
      return;
    }

    const text = composer.trim();
    if (!text) {
      return;
    }

    setBusyAction("send");
    try {
      const skillSlash = snapshot ? matchSkillSlashInput(text, snapshot.skillsList) : undefined;
      const next = skillSlash
        ? await api.submitSkillSlash({
            skillName: skillSlash.skillName,
            rawText: text,
            ...(skillSlash.extraNote ? { extraNote: skillSlash.extraNote } : {}),
          })
        : await api.submitUserTurn(text);
      applySnapshot(next);
      setComposer("");
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, composer, snapshot]);
  
  const rewindAndSubmitMessage = useCallback(
    async (request: RewindAndSubmitMessageRequest): Promise<boolean> => {
      if (!api) {
        return false;
      }

      setBusyAction("rewind");
      try {
        const next = await api.rewindAndSubmitMessage(request);
        applySnapshot(next);
        setComposer("");
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
    [api, applySnapshot, refreshSessions],
  );

  const submitApproval = useCallback(async () => {
    if (!api) {
      return;
    }

    const message = approvalMessage.trim();
    if (!message) {
      return;
    }

    setBusyAction("approve");
    try {
      const next = await api.replyPendingApproval(message);
      applySnapshot(next);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, approvalMessage]);

  const submitQuestions = useCallback(async () => {
    if (!api || !pendingQuestions) {
      return;
    }

    const built = buildAskQuestionsResult(pendingQuestions.request, questionDrafts);
    if (!built.result) {
      setQuestionError(built.error ?? "请先完成问卷。");
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
      setBusyAction("session");
      try {
        const next = await api.openSession(path);
        applySnapshot(next);
        setComposer("");
        setQuestionError("");
        setRuntimeError("");
        void refreshSessions();
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot, refreshSessions],
  );

  const resetSession = useCallback(async () => {
    if (!api) {
      return;
    }

    setBusyAction("reset");
    try {
      const next = await api.resetSession();
      applySnapshot(next);
      setComposer("");
      setQuestionError("");
      setRuntimeError("");
      void refreshSessions();
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

  const summary = useMemo(() => {
    return {
      canSend:
        !!snapshot?.runtimeReady &&
        !snapshot.conversation.isBusy &&
        !snapshot.conversation.pendingToolApproval &&
        !snapshot.conversation.pendingQuestions,
      hostStatus: hostError
        ? hostError
        : hostReady
          ? kind === "electron"
            ? "Electron Desktop"
            : "localhost Web Host"
          : "连接宿主中…",
    };
  }, [hostError, hostReady, kind, snapshot]);

  return {
    apiReady: hostReady,
    hostConnectionError: hostError,
    busyAction,
    composer,
    hostKind: kind,
    pendingQuestions,
    questionDrafts,
    questionError,
    refreshSessions,
    runtimeError,
    sessions,
    settings,
    snapshot,
    summary,
    webHostPairingRequired,
    approvalMessage,
    setActiveModel,
    setApprovalMessage,
    setComposer,
    setQuestionDrafts,
    setSettings,
    updateQuestionDraft,
    bootstrap,
    addModel,
    removeModel,
    createSkill,
    deleteSkill,
    openSession,
    pairWebHost,
    resetSession,
    rewindAndSubmitMessage,
    saveSettingsPatch,
    resetWebHostPairing,
    sendMessage,
    skipQuestions,
    submitApproval,
    submitQuestions,
  };
}
