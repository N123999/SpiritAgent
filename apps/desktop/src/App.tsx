import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { SessionSidebarChromeProvider } from "@/contexts/session-sidebar-chrome-context";
import { ActionPickerDialog } from "@/components/action-picker-dialog";
import { AutomationDetailView } from "@/components/automation-detail-view";
import { AutomationsView } from "@/components/automations-view";
import { BranchCheckoutDialog } from "@/components/branch-checkout-dialog";
import { ConversationView } from "@/components/conversation/conversation-view";
import { CreateAutomationDialog } from "@/components/create-automation-dialog";
import { DesktopTitleBar } from "@/components/desktop-title-bar";
import { DesktopLayoutChromeBar } from "@/components/layout/desktop-layout-chrome-bar";
import { LaunchSplash } from "@/components/launch-splash";
import { MarketplaceView } from "@/components/marketplace-view";
import { SessionSidebar } from "@/components/session-sidebar";
import { SessionSidebarShell } from "@/components/session-sidebar-shell";
import { SettingsView } from "@/components/settings-view";
import { WebHostPairingGate } from "@/components/web-host-pairing-gate";
import { WorkspaceFilePickerDialog } from "@/components/workspace-file-picker-dialog";
import { WorkspaceMarkdownLinkProvider } from "@/components/workspace-markdown-link-context";
import { useAppSurfaceNavigation } from "@/hooks/useAppSurfaceNavigation";
import { useClickablePointerCursor } from "@/hooks/useClickablePointerCursor";
import { useCompactionUiDemo } from "@/hooks/useCompactionUiDemo";
import { useComposerController } from "@/hooks/useComposerController";
import { useConversationSessionFocusComposer } from "@/hooks/useConversationSessionFocusComposer";
import { useConversationViewState } from "@/hooks/useConversationViewState";
import { useUiLayoutScale } from "@/hooks/useUiLayoutScale";
import { useDesktopKeyboardShortcuts } from "@/hooks/useDesktopKeyboardShortcuts";
import { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { useDesktopRuntimeErrorToast } from "@/hooks/use-desktop-runtime-error-toast";
import { useDesktopQuestionErrorToast } from "@/hooks/use-desktop-question-error-toast";
import { useDesktopShellEffects } from "@/hooks/useDesktopShellEffects";
import { useFont } from "@/hooks/useFont";
import { useMessageRewind } from "@/hooks/useMessageRewind";
import { useSubagentViewer } from "@/hooks/useSubagentViewer";
import { useTheme } from "@/hooks/useTheme";
import { useGitHubAuthConnected } from "@/hooks/use-github-auth-connected";
import { useWorkspaceToolsController } from "@/hooks/useWorkspaceToolsController";
import { desktopMicaTintClass, desktopMicaTintInnerClass } from "@/lib/desktop-mica-surface";
import {
  isDarwinElectronShell,
  isElectronChrome,
  isWin32ElectronShell,
  resolveUseMicaBackdrop,
} from "@/lib/desktop-shell";
import { isMarkdownPath } from "@/lib/file-picker-path";
import { isWorkspaceReferenceDirectoryPath, normalizeWorkspaceReferenceDirectoryPath } from "@spirit-agent/host-internal/workspace-file-reference-query";
import { tryHandleDesktopWorkspaceLink } from "@/lib/workspace-navigation-link";
import {
  applyUiLayoutScaleToDocument,
  UI_LAYOUT_SCALE_ROOT_ID,
} from "@/lib/ui-layout-scale";
import { resolveDark } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function App() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { font, setFont } = useFont();
  const { clickablePointerCursor, setClickablePointerCursor } = useClickablePointerCursor();
  const uiLayoutScale = useUiLayoutScale();
  const runtime = useDesktopRuntime();
  useDesktopRuntimeErrorToast(runtime.runtimeError);
  useDesktopQuestionErrorToast(runtime.questionError);
  const snapshot = runtime.snapshot;
  /** 与 Host API 的 `kind` 解耦：壳可能是 Electron，但仍通过 Vite 代理走 Web Host（侧栏会显示 Localhost Web Host）。Mica 与 `spirit-desktop-native` 仍应对 Electron 窗口生效。 */
  const isElectronShell = isElectronChrome();
  const winElectronChrome = isWin32ElectronShell();
  const darwinElectronChrome = isDarwinElectronShell();
  const desktopTitleBarChrome = winElectronChrome || darwinElectronChrome;
  // snapshot 未就绪时读磁盘，避免 settings 默认 windowsMica:true 在启动层误开透明/材质
  const useMicaBackdrop = resolveUseMicaBackdrop(
    snapshot != null ? runtime.settings.windowsMica : undefined,
  );

  useDesktopShellEffects({
    isElectronShell,
    darwinElectronChrome,
    useMicaBackdrop,
    theme,
    extensionCss: snapshot?.extensionCss,
  });

  const compactionDemo = useCompactionUiDemo();
  const subagentViewer = useSubagentViewer(runtime.setSubagentViewerTarget);
  const subagentViewActive = subagentViewer.active && Boolean(snapshot?.subagentViewer);
  const sessionMessages = snapshot?.conversation.messages ?? [];
  const sessionNavigationBusy = runtime.busyAction === "session";
  const newSessionBusy = runtime.busyAction === "reset";
  const composerAutomationApiRef = useRef<{
    setSlashSelectedIndex: (index: number) => void;
    focusComposer: () => void;
  } | null>(null);

  // Hook order is intentional — do not reorder without checking cross-hook deps:
  // 1. surfaceNav — session surface routing; handleGenerateAutomation reads composerAutomationApiRef
  // 2. conversation — message list / pending approval state consumed by composer + rewind
  // 3. workspaceTools — independent of composer; safe after conversation
  // 4. composer — needs surfaceNav.isEmptySession + conversation pending flags
  // 5. composerAutomationApiRef effect — bridges composer into surfaceNav (after composer exists)
  // 6. messageRewind — needs composer.messageRewindComposerEnabled
  // 7. keyboard shortcuts — reads refs from surfaceNav / conversation / composer
  const surfaceNav = useAppSurfaceNavigation({
    runtime,
    snapshot,
    sessionMessages,
    subagentViewActive,
    compactionDemoActive: compactionDemo.active,
    sessionNavigationBusy,
    newSessionBusy,
    t,
    composerAutomationApiRef,
  });

  const conversation = useConversationViewState({
    runtime,
    snapshot,
    subagentViewActive,
    subagentViewer,
    compactionDemo,
    t,
    language: i18n.language,
  });

  const activeFilePath = snapshot?.activeSession?.filePath ?? null;

  const workspaceTools = useWorkspaceToolsController({
    runtime,
    snapshot,
    activeFilePath,
  });

  const gitHubAuthConnected = useGitHubAuthConnected(
    runtime.getGitHubAuthStatus,
    workspaceTools.prTabEnabled,
  );

  const openIntegrationsSettings = useCallback(() => {
    surfaceNav.handleOpenSettings();
    surfaceNav.setExtensionSettingsId(null);
    surfaceNav.setSettingsTab("integrations");
  }, [surfaceNav]);

  const composer = useComposerController({
    runtime,
    snapshot,
    t,
    isEmptySession: surfaceNav.isEmptySession,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
    compactionDemoActive: compactionDemo.active,
    subagentViewActive,
    pendingApproval: conversation.pendingApproval,
    pendingQuestions: conversation.pendingQuestions,
    conversationInterruptible: conversation.conversationInterruptible,
    handleNewSession: surfaceNav.handleNewSession,
    setActiveSurface: surfaceNav.setActiveSurface,
    setLastNonSettingsSurface: surfaceNav.setLastNonSettingsSurface,
  });

  useEffect(() => {
    composerAutomationApiRef.current = {
      setSlashSelectedIndex: composer.setSlashSelectedIndex,
      focusComposer: composer.focusComposer,
    };
  }, [composer.focusComposer, composer.setSlashSelectedIndex]);

  useConversationSessionFocusComposer({
    composerSessionKey: conversation.composerSessionKey,
    focusComposer: composer.focusComposer,
    enabled:
      snapshot != null
      && surfaceNav.activeSurface === "conversation"
      && !surfaceNav.settingsMode
      && !sessionNavigationBusy
      && !newSessionBusy,
  });

  const messageRewind = useMessageRewind({
    runtime,
    messages: conversation.messages,
    subagentViewer,
    messageRewindComposerEnabled: composer.messageRewindComposerEnabled,
    activeSessionReadOnly: conversation.activeSessionReadOnly,
  });

  useDesktopKeyboardShortcuts({
    runtime,
    activeSurfaceRef: surfaceNav.activeSurfaceRef,
    conversationAbortShortcutEligibleRef: conversation.conversationAbortShortcutEligibleRef,
    sessionSidebarChromeApiRef: surfaceNav.sessionSidebarChromeApiRef,
    handleNewSession: surfaceNav.handleNewSession,
    handleOpenSettings: surfaceNav.handleOpenSettings,
    handleCloseSettings: surfaceNav.handleCloseSettings,
    setActionPickerOpen: composer.setActionPickerOpen,
    setFilePickerOpen: composer.setFilePickerOpen,
    uiLayoutScaleApi: uiLayoutScale,
  });

  const launchSplashActive =
    snapshot === null &&
    !runtime.hostConnectionError.trim() &&
    !runtime.runtimeError.trim();

  useLayoutEffect(() => {
    applyUiLayoutScaleToDocument(uiLayoutScale.scale);
  }, [uiLayoutScale.scale]);

  const handleWorkspaceMarkdownLinkClick = useCallback(
    (href: string) =>
      tryHandleDesktopWorkspaceLink(
        href,
        {
          openPullRequestInPrTab: workspaceTools.openPullRequestInPrTab,
          openBrowserUrlInNewTab: workspaceTools.openBrowserUrlInNewTab,
        },
        {
          hostKind: runtime.hostKind ?? undefined,
          interceptPrInApp: workspaceTools.prTabEnabled && gitHubAuthConnected === true,
        },
      ),
    [
      gitHubAuthConnected,
      runtime.hostKind,
      workspaceTools.openBrowserUrlInNewTab,
      workspaceTools.openPullRequestInPrTab,
      workspaceTools.prTabEnabled,
    ],
  );

  if (runtime.webHostPairingRequired && runtime.hostKind === "web" && !snapshot) {
    return (
      <WebHostPairingGate
        busy={runtime.busyAction === "bootstrap"}
        onPair={runtime.pairWebHost}
      />
    );
  }

  return (
    <WorkspaceMarkdownLinkProvider onLinkClick={handleWorkspaceMarkdownLinkClick}>
    <SessionSidebarChromeProvider apiRef={surfaceNav.sessionSidebarChromeApiRef}>
    <div
      data-spirit-surface="desktop-chrome-root"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      {winElectronChrome ? (
        <DesktopTitleBar
          useMicaBackdrop={useMicaBackdrop}
          onZoomIn={uiLayoutScale.zoomIn}
          onZoomOut={uiLayoutScale.zoomOut}
          onZoomReset={uiLayoutScale.resetScale}
        />
      ) : null}
      <div
        id={UI_LAYOUT_SCALE_ROOT_ID}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
    <div
      data-spirit-surface="app-shell"
      data-spirit-shell-kind={isElectronShell ? "electron" : "web"}
      data-spirit-theme={resolveDark(theme) ? "dark" : "light"}
      data-spirit-mica={useMicaBackdrop ? "true" : "false"}
      className={cn(
        "flex h-full min-h-0 flex-col",
        useMicaBackdrop ? "bg-transparent" : "bg-background",
      )}
    >
      <LaunchSplash active={launchSplashActive} useMicaBackdrop={useMicaBackdrop} />
      <div data-spirit-surface="app-body" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!desktopTitleBarChrome ? (
          <div
            className={cn(
              "h-px w-full shrink-0",
              // 非 Electron：壳顶部分隔线
              useMicaBackdrop
                ? "bg-black/5 dark:bg-white/10"
                : "bg-border/30 dark:bg-white/12",
            )}
            role="separator"
            aria-orientation="horizontal"
          />
        ) : null}
        <div data-spirit-surface="main-frame" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <SessionSidebarShell useMicaBackdrop={useMicaBackdrop}>
          <SessionSidebar
            narrow={false}
            mode={surfaceNav.settingsMode ? "settings" : "sessions"}
            userHomeDirectory={snapshot?.userHomeDirectory ?? null}
            sessions={runtime.sessions}
            activeFilePath={activeFilePath}
            onNewSession={surfaceNav.handleNewSession}
            onNewSessionInWorkspace={(workspaceRoot) => {
              void surfaceNav.handleNewSessionInWorkspace(workspaceRoot);
            }}
            onSelectSession={(path) => {
              surfaceNav.setLastNonSettingsSurface("conversation");
              surfaceNav.setActiveSurface("conversation");
              void runtime.openSession(path);
            }}
            onOpenMarketplace={() => {
              surfaceNav.sessionSidebarChromeApiRef.current?.openSidebar();
              surfaceNav.setLastNonSettingsSurface("marketplace");
              surfaceNav.setActiveSurface("marketplace");
            }}
            onOpenAutomations={() => {
              surfaceNav.sessionSidebarChromeApiRef.current?.openSidebar();
              surfaceNav.setLastNonSettingsSurface("automations");
              surfaceNav.setSelectedAutomationId(null);
              surfaceNav.setActiveSurface("automations");
            }}
            onOpenSettings={surfaceNav.handleOpenSettings}
            onBackToSessions={surfaceNav.handleCloseSettings}
            marketplaceActive={surfaceNav.marketplaceMode}
            automationsActive={surfaceNav.automationsMode}
            settingsTab={surfaceNav.settingsTab}
            extensionSettingsId={surfaceNav.extensionSettingsId}
            extensionSettingsItems={surfaceNav.extensionSettingsItems}
            onSettingsTabChange={(tab) => {
              surfaceNav.setExtensionSettingsId(null);
              surfaceNav.setSettingsTab(tab);
            }}
            onExtensionSettingsChange={(id) => surfaceNav.setExtensionSettingsId(id)}
            micaStyle={useMicaBackdrop}
            newSessionBusy={newSessionBusy}
            sessionNavigationBusy={sessionNavigationBusy}
            deleteSessionBusy={sessionNavigationBusy}
            onDeleteSession={(path) => runtime.deleteSession(path)}
            deleteWorkspaceBusy={sessionNavigationBusy}
            onDeleteWorkspace={(workspacePath) => runtime.deleteWorkspace(workspacePath)}
            unseenCompletedSessionPaths={runtime.unseenCompletedSessionPaths}
          />
        </SessionSidebarShell>

        {surfaceNav.settingsMode ? (
          <div data-spirit-surface="settings-shell" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", desktopMicaTintInnerClass(useMicaBackdrop))}>
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              showWorkspaceToggle={false}
            />
            <SettingsView
              useMicaBackdrop={useMicaBackdrop}
              tab={surfaceNav.settingsTab}
              extensionSettingsId={surfaceNav.extensionSettingsId}
              theme={theme}
              onThemeChange={setTheme}
              font={font}
              onFontChange={setFont}
              clickablePointerCursor={clickablePointerCursor}
              onClickablePointerCursorChange={setClickablePointerCursor}
              settings={runtime.settings}
              snapshot={snapshot}
              apiReady={runtime.apiReady}
              busyAction={runtime.busyAction}
              modelsBusy={runtime.busyAction === "models"}
              modelsPreviewBusy={runtime.busyAction === "modelsPreview"}
              mcpsBusy={runtime.busyAction === "mcps"}
              hooksBusy={runtime.busyAction === "hooks"}
              skillsBusy={runtime.busyAction === "skills"}
              rulesBusy={runtime.busyAction === "rules"}
              extensionsBusy={runtime.busyAction === "extensions"}
              lspInstallBusy={runtime.lspInstallBusy}
              isElectronShell={isElectronShell}
              onSavePatch={runtime.saveSettingsPatch}
              onInstallLspProvider={runtime.installLspProvider}
              onResetWebHostPairing={runtime.resetWebHostPairing}
              onAddModel={runtime.addModel}
              onAddProviderModels={runtime.addProviderModels}
              onPreviewModels={runtime.previewModels}
              onRemoveModel={runtime.removeModel}
              onRemoveProviderModels={runtime.removeProviderModels}
              onAddMcpServer={runtime.addMcpServer}
              onImportExtension={runtime.importExtension}
              onDeleteExtension={runtime.deleteExtension}
              onUpdateExtensionSettings={runtime.updateExtensionSettings}
              onUpdateExtensionSecret={runtime.updateExtensionSecret}
              onDeleteMcpServer={runtime.deleteMcpServer}
              onSaveHookEntry={runtime.saveHookEntry}
              onDeleteHookEntry={runtime.deleteHookEntry}
              onInspectMcpServer={runtime.inspectMcpServer}
              onCreateSkill={runtime.createSkill}
              onCreateRule={runtime.createRule}
              onStartCompactionUiDemo={() => {
                surfaceNav.setActiveSurface("conversation");
                compactionDemo.start();
              }}
              onDeleteSkill={runtime.deleteSkill}
              onDeleteRule={runtime.deleteRule}
              onListDreamsOverview={runtime.listDreamsOverview}
              onGenerateSkillNavigate={() => {
                composer.prefillComposerSkillChip("create-skill");
              }}
              onGenerateRuleNavigate={() => {
                composer.prefillComposerSkillChip("create-rule");
              }}
              onGenerateHookNavigate={() => {
                composer.prefillComposerSkillChip("create-hook");
              }}
              getGitHubAuthStatus={runtime.getGitHubAuthStatus}
              beginGitHubDeviceLogin={runtime.beginGitHubDeviceLogin}
              completeGitHubDeviceLogin={runtime.completeGitHubDeviceLogin}
              cancelGitHubDeviceLogin={runtime.cancelGitHubDeviceLogin}
              disconnectGitHub={runtime.disconnectGitHub}
            />
          </div>
        ) : surfaceNav.automationsMode ? (
          <div data-spirit-surface="automations-layout" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", desktopMicaTintInnerClass(useMicaBackdrop))}>
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              showWorkspaceToggle={false}
            />
            <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", desktopMicaTintClass(useMicaBackdrop))}>
            {surfaceNav.automationDetailMode && surfaceNav.selectedAutomationId ? (
              <AutomationDetailView
                automationId={surfaceNav.selectedAutomationId}
                snapshot={snapshot}
                onBack={() => {
                  surfaceNav.setSelectedAutomationId(null);
                  surfaceNav.setActiveSurface("automations");
                }}
                onOpenSession={(path) => {
                  surfaceNav.setLastNonSettingsSurface("conversation");
                  surfaceNav.setActiveSurface("conversation");
                  void runtime.openSession(path);
                }}
                getAutomation={runtime.getAutomation}
                updateAutomation={(id, patch) => void runtime.updateAutomation(id, patch)}
                settingsDisabled={!runtime.apiReady || runtime.busyAction === "automation"}
                githubConnected={gitHubAuthConnected === true}
                githubAuthChecking={gitHubAuthConnected === null}
                onOpenIntegrationsSettings={openIntegrationsSettings}
                listGitHubRepositories={runtime.listGitHubAutomationRepositories}
                searchGitHubRepositories={runtime.searchGitHubAutomationRepositories}
                onAddWorkspace={() => void runtime.pickWorkspaceDirectory?.().then((path) => {
                  if (path) {
                    void runtime.rememberWorkspaceRoot(path);
                  }
                })}
              />
            ) : (
              <AutomationsView
                snapshot={snapshot}
                apiReady={runtime.apiReady}
                busyAction={runtime.busyAction}
                githubConnected={gitHubAuthConnected === true}
                onGenerateAutomation={() => void surfaceNav.handleGenerateAutomation()}
                onCreateAutomation={() => surfaceNav.setCreateAutomationDialogOpen(true)}
                onOpenAutomation={(automationId) => {
                  surfaceNav.setSelectedAutomationId(automationId);
                  surfaceNav.setActiveSurface("automation-detail");
                }}
                onDeleteAutomation={async (automationId) => {
                  await runtime.deleteAutomation(automationId);
                  if (surfaceNav.selectedAutomationId === automationId) {
                    surfaceNav.setSelectedAutomationId(null);
                    surfaceNav.setActiveSurface("automations");
                  }
                }}
              />
            )}
            <CreateAutomationDialog
              open={surfaceNav.createAutomationDialogOpen}
              onOpenChange={surfaceNav.setCreateAutomationDialogOpen}
              snapshot={snapshot}
              disabled={!runtime.apiReady || runtime.busyAction === "automation"}
              githubConnected={gitHubAuthConnected === true}
              githubAuthChecking={gitHubAuthConnected === null}
              onOpenIntegrationsSettings={openIntegrationsSettings}
              listGitHubRepositories={runtime.listGitHubAutomationRepositories}
              searchGitHubRepositories={runtime.searchGitHubAutomationRepositories}
              onSubmit={(request) => void runtime.createAutomation(request)}
              onAddWorkspace={() => void runtime.pickWorkspaceDirectory?.().then((path) => {
                if (path) {
                  void runtime.rememberWorkspaceRoot(path);
                }
              })}
            />
            </div>
          </div>
        ) : surfaceNav.marketplaceMode ? (
          <div data-spirit-surface="marketplace-layout" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", desktopMicaTintInnerClass(useMicaBackdrop))}>
            <DesktopLayoutChromeBar
              useMicaBackdrop={useMicaBackdrop}
              showWorkspaceToggle={false}
            />
            <MarketplaceView
              useMicaBackdrop={useMicaBackdrop}
              snapshot={snapshot}
              apiReady={runtime.apiReady}
              busyAction={runtime.busyAction}
              onListMarketplaceExtensions={runtime.listMarketplaceExtensions}
              onGetMarketplaceExtensionDetail={runtime.getMarketplaceExtensionDetail}
              onGetMarketplaceExtensionReadme={runtime.getMarketplaceExtensionReadme}
              onPrepareMarketplaceExtensionInstall={runtime.prepareMarketplaceExtensionInstall}
              onInstallMarketplaceExtension={runtime.installMarketplaceExtension}
            />
          </div>
        ) : null}

        {surfaceNav.preserveConversationSurface ? (
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              desktopMicaTintInnerClass(useMicaBackdrop),
              surfaceNav.settingsMode && "hidden",
            )}
            aria-hidden={surfaceNav.settingsMode}
          >
          <ConversationView
            useMicaBackdrop={useMicaBackdrop}
            isEmptySession={surfaceNav.isEmptySession}
            hideStaleConversationMessages={surfaceNav.hideStaleConversationMessages}
            snapshot={snapshot}
            subagentViewActive={subagentViewActive}
            onExitSubagentViewer={
              subagentViewActive
                ? () => {
                    void subagentViewer.close();
                  }
                : undefined
            }
            onNewSession={surfaceNav.handleNewSession}
            newSessionBusy={newSessionBusy}
            compactionDemoActive={compactionDemo.active}
            onCompactionDemoStop={compactionDemo.stop}
            rewindDraft={messageRewind.rewindDraft}
            onRewindDraftClear={() => messageRewind.setRewindDraft(null)}
            conversationScrollBedPaddingPx={conversation.conversationScrollBedPaddingPx}
            list={{
              messages: conversation.messages,
              conversationRenderItems: conversation.conversationRenderItems,
              composerSessionKey: conversation.composerSessionKey,
              conversationListScopeKey: conversation.conversationListScopeKey,
              conversationListRemountEpoch: conversation.conversationListRemountEpoch,
              conversationPendingAuxState: conversation.conversationPendingAuxState,
              processGroupManualOpen: conversation.processGroupManualOpen,
              processGroupManualOpenKey: conversation.processGroupManualOpenKey,
              onProcessGroupManualOpenChange: (groupId, open) => {
                conversation.setProcessGroupManualOpen((current) => ({
                  ...current,
                  [conversation.processGroupManualOpenKey(groupId)]: open,
                }));
              },
              shouldPlayProcessSealAnimation: conversation.shouldPlayProcessSealAnimation,
              runtime,
              turnContinue: conversation.turnContinue,
              activeSessionReadOnly: conversation.activeSessionReadOnly,
              continueBusy: conversation.continueBusy,
              rewindDraft: messageRewind.rewindDraft,
              onRewindDraftChange: messageRewind.setRewindDraft,
              messageRewindComposerEnabled: composer.messageRewindComposerEnabled,
              rewindRichInputRef: messageRewind.rewindRichInputRef,
              models: conversation.models,
              onOpenSubagentViewer: subagentViewActive ? undefined : conversation.handleOpenSubagentViewer,
              onOpenReadFile: (target) => {
                workspaceTools.openEditorFile(target);
              },
              onStartMessageRewind: messageRewind.startMessageRewind,
              onForkMessage: (message, listIndex) => {
                void runtime.forkSession({ messageId: message.id, listIndex });
              },
              onSubmitMessageRewind: messageRewind.submitMessageRewind,
              onRewindRemoveLocalFileAttachment: messageRewind.removeRewindLocalFileAttachment,
              onRewindPickLocalFile: messageRewind.pickRewindLocalFileFromPalette,
              onRewindPaste: messageRewind.handleRewindComposerPaste,
              onRewindDragOver: messageRewind.handleRewindComposerDragOver,
              onRewindDrop: messageRewind.handleRewindComposerDrop,
              onComposerAgentModeChange: composer.handleComposerAgentModeChange,
            }}
            composerDock={{
              composerDockRef: conversation.composerDockRef,
              emptySessionGreeting: conversation.emptySessionGreeting,
              showWorkspaceBindingControls: surfaceNav.showWorkspaceBindingControls,
              commitBusy: composer.commitBusy,
              rewindWarnings: conversation.rewindWarnings,
              showPendingApprovalInComposer: conversation.showPendingApprovalInComposer,
              pendingApproval: conversation.pendingApproval,
              showPendingQuestionsInComposer: conversation.showPendingQuestionsInComposer,
              fileReferenceSuggestions: composer.fileReferenceSuggestions,
              fileReferenceSelectedIndex: composer.fileReferenceSelectedIndex,
              onFileReferenceSelectedIndexChange: composer.setFileReferenceSelectedIndex,
              onApplyFileReferenceSuggestion: composer.applyFileReferenceSuggestion,
              onDismissFileReferenceSuggestions: composer.dismissFileReferenceSuggestions,
              activeFileReferenceQuery: composer.activeFileReferenceQuery,
              slashQuery: composer.slashQuery,
              slashSuggestions: composer.slashSuggestions,
              slashSelectedIndex: composer.slashSelectedIndex,
              onSlashSelectedIndexChange: composer.setSlashSelectedIndex,
              onApplySlashSuggestionItem: composer.applySlashSuggestionItem,
              onDismissSlashSuggestions: composer.dismissSlashSuggestions,
              composerCursorCodeUnits: composer.composerCursorCodeUnits,
              composerPlaceholder: composer.composerPlaceholder,
              composerCanSend: composer.composerCanSend,
              conversationInterruptible: conversation.conversationInterruptible,
              composerBrowserElementAttachments: composer.composerBrowserElementAttachments,
              onComposerBrowserElementAttachmentsChange: composer.setComposerBrowserElementAttachments,
              onSubmitComposerMessage: composer.submitComposerMessage,
              onComposerAgentModeChange: composer.handleComposerAgentModeChange,
              composerRichInputRef: composer.composerRichInputRef,
              onComposerKeyDown: composer.handleComposerKeyDown,
              onComposerCursorCodeUnitsChange: composer.setComposerCursorCodeUnits,
              onInsertFileReferenceTrigger: composer.insertFileReferenceTrigger,
              onPickLocalFileFromPalette: composer.pickLocalFileFromPalette,
              onInsertSkillTriggerFromPalette: composer.insertSkillTriggerFromPalette,
              onRemoveLocalFileAttachment: composer.removeLocalFileAttachment,
              onComposerPaste: composer.handleComposerPaste,
              onComposerDragOver: composer.handleComposerDragOver,
              onComposerDrop: composer.handleComposerDrop,
              onComposerSegmentsCommit: composer.handleComposerSegmentsCommit,
              models: conversation.models,
              onOpenGitTab: workspaceTools.openGitTab,
            }}
            workspaceTools={{
              startImplementingDisabled: conversation.startImplementingDisabled,
              workspaceFilesPlanRevealNonce: workspaceTools.workspaceFilesPlanRevealNonce,
              workspaceFilesPlanRevealTargetId: workspaceTools.workspaceFilesPlanRevealTargetId,
              workspaceFileRevealNonce: workspaceTools.workspaceFileRevealNonce,
              workspaceFileRevealTargetId: workspaceTools.workspaceFileRevealTargetId,
              workspaceFileRevealPath: workspaceTools.workspaceFileRevealPath,
              workspaceFileRevealAbsolutePath: workspaceTools.workspaceFileRevealAbsolutePath,
              workspaceFileRevealScope: workspaceTools.workspaceFileRevealScope,
              workspaceFileRevealViewMode: workspaceTools.workspaceFileRevealViewMode,
              workspaceFileRevealDirectoryOnly: workspaceTools.workspaceFileRevealDirectoryOnly,
              workspaceFileRevealLine: workspaceTools.workspaceFileRevealLine,
              workspaceFileRevealColumn: workspaceTools.workspaceFileRevealColumn,
              workspacePrRevealNonce: workspaceTools.workspacePrRevealNonce,
              workspacePrRevealTargetId: workspaceTools.workspacePrRevealTargetId,
              workspacePrRevealRequest: workspaceTools.workspacePrRevealRequest,
              onOpenWorkspaceFile: workspaceTools.openWorkspaceFile,
              onOpenWorkspaceFileInNewTab: workspaceTools.openWorkspaceFileInNewTab,
              workspaceToolTabs: workspaceTools.workspaceToolTabs,
              activeWorkspaceToolTabId: workspaceTools.activeWorkspaceToolTabId,
              onWorkspaceToolTabsChange: workspaceTools.setWorkspaceToolTabs,
              onActiveWorkspaceToolTabIdChange: workspaceTools.setActiveWorkspaceToolTabId,
              onBrowserElementPicked: composer.handleBrowserElementPicked,
              onPrDiffAddToSession: composer.handlePrDiffAddToSession,
              onTerminalAddToSession: composer.handleTerminalAddToSession,
              onFileSnippetAddToSession: composer.handleFileSnippetAddToSession,
              onWorkspaceFileAddToSession: composer.handleWorkspaceFileAddToSession,
              onGitCommitAddToSession: composer.handleGitCommitAddToSession,
              onBrowserOpenInNewTab: workspaceTools.openBrowserUrlInNewTab,
              browserTabEnabled: workspaceTools.browserTabEnabled,
              prTabEnabled: workspaceTools.prTabEnabled,
              onOpenIntegrationsSettings: openIntegrationsSettings,
              workspaceToolsWidthPx: workspaceTools.workspaceToolsWidthPx,
              onWorkspaceToolsWidthPxChange: workspaceTools.setWorkspaceToolsWidthPx,
              gitChipBusy: composer.gitChipBusy,
            }}
          />
          </div>
        ) : null}
        </div>
      </div>

      <ActionPickerDialog
        open={composer.actionPickerOpen}
        onOpenChange={composer.setActionPickerOpen}
        onSelect={composer.runActionPaletteItem}
        isItemDisabled={composer.isActionPaletteItemDisabled}
      />

      <WorkspaceFilePickerDialog
        open={composer.filePickerOpen}
        onOpenChange={composer.setFilePickerOpen}
        workspaceRoot={snapshot?.workspaceRoot ?? ''}
        workspaceBinding={snapshot?.workspaceBinding ?? 'project'}
        onOpenWorkspaceFile={(relativePath) => {
          if (isWorkspaceReferenceDirectoryPath(relativePath)) {
            workspaceTools.revealWorkspaceDirectory(
              normalizeWorkspaceReferenceDirectoryPath(relativePath),
            );
            return;
          }
          workspaceTools.openWorkspaceFile(relativePath, {
            viewMode: isMarkdownPath(relativePath) ? "preview" : "edit",
          });
        }}
        onOpenExternalFile={(absolutePath) => {
          workspaceTools.openEditorFile({
            scope: "external",
            absolutePath,
            viewMode: isMarkdownPath(absolutePath) ? "preview" : "edit",
          });
        }}
        statHostTextFile={runtime.statHostTextFile}
        indexReady={composer.workspaceFileIndex.ready}
        searchWorkspaceFiles={composer.workspaceFileIndex.searchFilesOnly}
      />

      <BranchCheckoutDialog
        open={composer.branchCheckoutDialogOpen}
        onOpenChange={composer.handleBranchCheckoutDialogOpenChange}
        branchCheckoutBlockedByChanges={composer.branchCheckoutBlockedByChanges}
        git={snapshot?.git}
        commitBusy={composer.commitBusy}
        onCancel={composer.cancelBranchCheckoutDialog}
        onConfirmCheckout={composer.confirmBranchCheckoutAndSend}
        onDiscardAndCheckout={composer.discardBranchChangesAndCheckoutSend}
      />

    </div>
      </div>
    </div>
    </SessionSidebarChromeProvider>
    </WorkspaceMarkdownLinkProvider>
  );
}
