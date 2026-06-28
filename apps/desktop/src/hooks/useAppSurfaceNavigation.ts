import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { TFunction } from "i18next";

import type { SessionSidebarChromeApi } from "@/contexts/session-sidebar-chrome-context";
import type { SettingsSidebarTab } from "@/components/session-sidebar";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import {
  resolveEffectiveEmptySession,
  shouldClearConversationSnapshotStale,
  shouldHideStaleConversationMessages,
  shouldMarkConversationSnapshotStale,
  shouldSuppressStaleConversation,
} from "@/lib/conversation-surface-stale";
import { sameWorkspacePath } from "@/lib/workspace-display-label";
import type { DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type AppSurface =
  | "conversation"
  | "settings"
  | "marketplace"
  | "automations"
  | "automation-detail";

export type NonSettingsSurface = "conversation" | "marketplace" | "automations";

export type ComposerAutomationApi = {
  setSlashSelectedIndex: (index: number) => void;
  focusComposer: () => void;
};

export type UseAppSurfaceNavigationOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  sessionMessages: DesktopSnapshot["conversation"]["messages"];
  subagentViewActive: boolean;
  compactionDemoActive: boolean;
  sessionNavigationBusy: boolean;
  newSessionBusy: boolean;
  t: TFunction;
  composerAutomationApiRef?: MutableRefObject<ComposerAutomationApi | null>;
};

export function useAppSurfaceNavigation({
  runtime,
  snapshot,
  sessionMessages,
  subagentViewActive,
  compactionDemoActive,
  sessionNavigationBusy,
  newSessionBusy,
  t,
  composerAutomationApiRef,
}: UseAppSurfaceNavigationOptions) {
  const [activeSurface, setActiveSurface] = useState<AppSurface>("conversation");
  const activeSurfaceRef = useRef(activeSurface);
  activeSurfaceRef.current = activeSurface;

  const [conversationSnapshotStale, setConversationSnapshotStale] = useState(false);
  const [lastNonSettingsSurface, setLastNonSettingsSurface] =
    useState<NonSettingsSurface>("conversation");
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [createAutomationDialogOpen, setCreateAutomationDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>("models");
  const [extensionSettingsId, setExtensionSettingsId] = useState<string | null>(null);
  const sessionSidebarChromeApiRef = useRef<SessionSidebarChromeApi | null>(null);

  useEffect(() => {
    if (shouldMarkConversationSnapshotStale(activeSurface)) {
      setConversationSnapshotStale(true);
    }
  }, [activeSurface]);

  useEffect(() => {
    if (
      shouldClearConversationSnapshotStale({
        activeSurface,
        sessionNavigationBusy,
        newSessionBusy,
      })
    ) {
      setConversationSnapshotStale(false);
    }
  }, [activeSurface, newSessionBusy, sessionNavigationBusy]);

  const settingsMode = activeSurface === "settings";
  const marketplaceMode = activeSurface === "marketplace";
  const automationsMode = activeSurface === "automations" || activeSurface === "automation-detail";
  const automationDetailMode = activeSurface === "automation-detail";
  const preserveConversationSurface =
    activeSurface === "conversation"
    || (settingsMode && lastNonSettingsSurface === "conversation");

  const suppressStaleConversation = shouldSuppressStaleConversation({
    conversationSnapshotStale,
    activeSurface,
    sessionNavigationBusy,
    newSessionBusy,
  });
  const hideStaleConversationMessages = shouldHideStaleConversationMessages({
    suppressStaleConversation,
    sessionNavigationBusy,
  });
  const isEmptySession = resolveEffectiveEmptySession({
    sessionMessageCount: sessionMessages.length,
    subagentViewActive,
    compactionDemoActive,
    newSessionBusy,
  });
  const showWorkspaceBindingControls = isEmptySession;

  const handleNewSession = useCallback(() => {
    if (runtime.busyAction === "reset") {
      return;
    }
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
    void runtime.resetSession();
  }, [runtime]);

  const handleNewSessionInWorkspace = useCallback(
    async (workspaceRoot: string) => {
      const trimmed = workspaceRoot.trim();
      if (!trimmed) {
        return;
      }

      setLastNonSettingsSurface("conversation");
      setActiveSurface("conversation");

      const currentRoot = snapshot?.workspaceRoot?.trim() ?? "";
      const needsSwitch =
        snapshot?.workspaceBinding !== "project"
        || !currentRoot
        || !sameWorkspacePath(currentRoot, trimmed);

      if (needsSwitch) {
        const switched = await runtime.switchWorkspaceRoot(trimmed);
        if (!switched) {
          return;
        }
      }

      await runtime.resetSession();
    },
    [runtime, snapshot?.workspaceBinding, snapshot?.workspaceRoot],
  );

  const handleGenerateAutomation = useCallback(async () => {
    setLastNonSettingsSurface("conversation");
    setActiveSurface("conversation");
    const seed = t("automations.generateComposerSeed");
    const resetOk = await runtime.resetSession();
    if (!resetOk) {
      return;
    }
    runtime.setComposer(seed);
    const composerApi = composerAutomationApiRef?.current;
    composerApi?.setSlashSelectedIndex(-1);
    queueMicrotask(() => {
      composerApi?.focusComposer();
    });
  }, [composerAutomationApiRef, runtime, t]);

  const handleOpenSettings = useCallback(() => {
    sessionSidebarChromeApiRef.current?.openSidebar();
    const current = activeSurfaceRef.current;
    if (current !== "settings") {
      setLastNonSettingsSurface(
        current === "marketplace"
          ? "marketplace"
          : current === "automations" || current === "automation-detail"
            ? "automations"
            : "conversation",
      );
    }
    setActiveSurface("settings");
  }, []);

  const handleCloseSettings = useCallback(() => {
    if (activeSurfaceRef.current !== "settings") {
      return;
    }
    setActiveSurface(lastNonSettingsSurface);
  }, [lastNonSettingsSurface]);

  const extensionSettingsItems = useMemo(
    () =>
      (snapshot?.extensionsList ?? [])
        .filter((item) => item.desktopSettingsPage)
        .map((item) => ({
          id: item.id,
          label: item.desktopSettingsPage?.title ?? item.displayName,
        })),
    [snapshot?.extensionsList],
  );

  return {
    activeSurface,
    setActiveSurface,
    activeSurfaceRef,
    conversationSnapshotStale,
    lastNonSettingsSurface,
    setLastNonSettingsSurface,
    selectedAutomationId,
    setSelectedAutomationId,
    createAutomationDialogOpen,
    setCreateAutomationDialogOpen,
    settingsTab,
    setSettingsTab,
    extensionSettingsId,
    setExtensionSettingsId,
    sessionSidebarChromeApiRef,
    settingsMode,
    marketplaceMode,
    automationsMode,
    automationDetailMode,
    preserveConversationSurface,
    suppressStaleConversation,
    hideStaleConversationMessages,
    isEmptySession,
    showWorkspaceBindingControls,
    handleNewSession,
    handleNewSessionInWorkspace,
    handleGenerateAutomation,
    handleOpenSettings,
    handleCloseSettings,
    extensionSettingsItems,
  };
}
