import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SettingsFormState } from "@/components/settings-view";
import { useHostApi } from "@/hooks/useHostApi";
import type {
  AskQuestionsAnswer,
  AskQuestionsQuestionSpec,
  AskQuestionsRequest,
  AskQuestionsResult,
  DesktopSnapshot,
  SessionListItem,
} from "@/types";

type BusyAction =
  | ""
  | "bootstrap"
  | "save"
  | "send"
  | "approve"
  | "questions"
  | "reset"
  | "session";

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
  const [composer, setComposer] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("approve");
  const [questionError, setQuestionError] = useState("");
  const [settings, setSettings] = useState({
    activeModel: "",
    apiBase: "",
    uiLocale: "",
    apiKey: "",
    windowsMica: true,
  });
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const pollTimerRef = useRef<number | null>(null);
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
      void refreshSessions();
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, refreshSessions]);

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

  const poll = useCallback(async () => {
    if (!api) {
      return;
    }

    try {
      const next = await api.poll();
      applySnapshot(next);
    } catch (error) {
      setRuntimeError(describeError(error));
    }
  }, [api, applySnapshot]);

  useEffect(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!api || !snapshot?.conversation.isBusy) {
      return;
    }

    pollTimerRef.current = window.setTimeout(() => {
      void poll();
    }, 900);

    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
    // 必须依赖 snapshot 整体，而不仅是 isBusy：忙时 isBusy 常为 true 不变，只有第一次
    // 会 schedule poll；下一次 poll 回来若 isBusy 仍为 true，需靠 snapshot 引用变化重新 schedule。
  }, [api, poll, snapshot]);

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
          const res = await api.updateConfig({
            activeModel: next.activeModel,
            apiBase: next.apiBase,
            windowsMica: next.windowsMica,
            ...(next.uiLocale.trim()
              ? { uiLocale: next.uiLocale.trim() }
              : { uiLocale: undefined }),
            ...(next.apiKey.trim() ? { apiKey: next.apiKey.trim() } : { apiKey: undefined }),
          });
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

  /** 合并补丁并立即写回宿主（设置页可编辑项） */
  const saveSettingsPatch = useCallback(
    async (patch: Partial<SettingsFormState>) => {
      if (!api) {
        return;
      }

      const s = { ...settingsRef.current, ...patch };
      settingsRef.current = s;
      setSettings(s);
      setBusyAction("save");
      try {
        const next = await api.updateConfig({
          activeModel: s.activeModel,
          apiBase: s.apiBase,
          windowsMica: s.windowsMica,
          ...(s.uiLocale.trim()
            ? { uiLocale: s.uiLocale.trim() }
            : { uiLocale: undefined }),
          ...(s.apiKey.trim() ? { apiKey: s.apiKey.trim() } : { apiKey: undefined }),
        });
        applySnapshot(next);
        setRuntimeError("");
        setSettings((current) => ({
          ...current,
          apiKey: "",
        }));
      } catch (error) {
        setRuntimeError(describeError(error));
      } finally {
        setBusyAction("");
      }
    },
    [api, applySnapshot],
  );

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
      const next = await api.submitUserTurn(text);
      applySnapshot(next);
      setComposer("");
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(describeError(error));
    } finally {
      setBusyAction("");
    }
  }, [api, applySnapshot, composer]);

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
    busyAction,
    composer,
    hostError,
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
    approvalMessage,
    setActiveModel,
    setApprovalMessage,
    setComposer,
    setQuestionDrafts,
    setSettings,
    updateQuestionDraft,
    bootstrap,
    openSession,
    resetSession,
    saveSettingsPatch,
    sendMessage,
    skipQuestions,
    submitApproval,
    submitQuestions,
  };
}
