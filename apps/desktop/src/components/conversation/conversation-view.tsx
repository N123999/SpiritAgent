import type {
  ClipboardEvent as ReactClipboardEvent,
  ComponentProps,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  Ref,
  RefObject,
  SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";

import { ComposerDock } from "@/components/conversation/composer-dock";
import { ConversationList } from "@/components/conversation/conversation-list";
import { DesktopLayoutChromeBar } from "@/components/layout/desktop-layout-chrome-bar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceToolsDock,
  type WorkspaceToolTab,
} from "@/components/workspace-tools-panel";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MAX_W,
} from "@/lib/conversation-layout-constants";
import { desktopMicaTintClass, desktopMicaTintInnerClass } from "@/lib/desktop-mica-surface";
import type { EditorFileTarget, WorkspaceEditorViewMode } from "@/lib/workspace-editor-navigation";
import type { ActiveSkillSlashQuery, SkillSlashSuggestion } from "@/lib/skill-slash";
import { cn } from "@/lib/utils";
import type {
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import type { ConversationRenderItem } from "@/lib/conversation-process-groups";
import type { TurnContinuePresentation } from "@/lib/conversation-continue-ui";
import type { PendingAssistantAux } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type ConversationListSectionProps = {
  messages: readonly ConversationMessageSnapshot[];
  conversationRenderItems: readonly ConversationRenderItem[];
  composerSessionKey: string;
  conversationListScopeKey: string;
  conversationListRemountEpoch: number;
  conversationPendingAuxState: PendingAssistantAux | undefined;
  processGroupManualOpen: Record<string, boolean>;
  processGroupManualOpenKey: (groupId: string) => string;
  onProcessGroupManualOpenChange: (groupId: string, open: boolean) => void;
  shouldPlayProcessSealAnimation: (groupId: string) => boolean;
  runtime: DesktopRuntime;
  turnContinue: TurnContinuePresentation | undefined;
  activeSessionReadOnly: boolean;
  continueBusy: boolean;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftChange: (
    updater: (current: MessageRewindDraftState | null) => MessageRewindDraftState | null,
  ) => void;
  messageRewindComposerEnabled: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  models: DesktopSnapshot["config"]["models"];
  onOpenSubagentViewer: ((toolCallId: string) => void) | undefined;
  onStartMessageRewind: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onForkMessage: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onSubmitMessageRewind: () => void;
  onRewindRemoveLocalFileAttachment: (path: string) => void;
  onRewindPickLocalFile: () => void;
  onRewindPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
};

export type ComposerDockSectionProps = {
  composerDockRef: Ref<HTMLDivElement | null>;
  emptySessionGreeting: string;
  showWorkspaceBindingControls: boolean;
  commitBusy: boolean;
  rewindWarnings: NonNullable<DesktopSnapshot["conversation"]["rewindWarnings"]>;
  showPendingApprovalInComposer: boolean;
  pendingApproval: DesktopSnapshot["conversation"]["pendingToolApproval"];
  showPendingQuestionsInComposer: boolean;
  fileReferenceSuggestions: WorkspaceFileReferenceSuggestionsResponse;
  fileReferenceSelectedIndex: number;
  onFileReferenceSelectedIndexChange: (index: number) => void;
  onApplyFileReferenceSuggestion: (path: string) => void;
  slashQuery: ActiveSkillSlashQuery | undefined;
  slashSuggestions: SkillSlashSuggestion[];
  slashSelectedIndex: number;
  onSlashSelectedIndexChange: (index: number) => void;
  onApplySlashSuggestionItem: (suggestion: SkillSlashSuggestion) => void;
  composerPlaceholder: string;
  composerCanSend: boolean;
  conversationInterruptible: boolean;
  composerBrowserElementAttachments: BrowserElementAttachment[];
  onComposerBrowserElementAttachmentsChange: (attachments: BrowserElementAttachment[]) => void;
  onSubmitComposerMessage: () => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
  composerRichInputRef: RefObject<ComposerRichInputHandle | null>;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerCursorCodeUnitsChange: (selectionStart: number) => void;
  onInsertFileReferenceTrigger: () => void;
  onPickLocalFileFromPalette: () => void;
  onInsertSkillTriggerFromPalette: () => void;
  onRemoveLocalFileAttachment: (path: string) => void;
  onComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  models: DesktopSnapshot["config"]["models"];
};

export type WorkspaceToolsSectionProps = {
  open: boolean;
  onToggle: () => void;
  startImplementingDisabled: boolean;
  workspaceFilesPlanRevealNonce: number;
  workspaceFilesPlanRevealTargetId: string | null;
  workspaceFileRevealNonce: number;
  workspaceFileRevealTargetId: string | null;
  workspaceFileRevealPath: string;
  workspaceFileRevealAbsolutePath: string;
  workspaceFileRevealScope: EditorFileTarget["scope"];
  workspaceFileRevealViewMode: WorkspaceEditorViewMode;
  onOpenWorkspaceFile: (
    relativePath: string,
    options?: { viewMode?: WorkspaceEditorViewMode },
  ) => void;
  workspaceToolTabs: WorkspaceToolTab[];
  activeWorkspaceToolTabId: string;
  onWorkspaceToolTabsChange: Dispatch<SetStateAction<WorkspaceToolTab[]>>;
  onActiveWorkspaceToolTabIdChange: (id: string) => void;
  onBrowserElementPicked: NonNullable<
    ComponentProps<typeof WorkspaceToolsDock>["onBrowserElementPicked"]
  >;
  onBrowserOpenInNewTab: (rawUrl: string) => void;
  browserTabEnabled: boolean;
  prTabEnabled: boolean;
  workspaceToolsWidthPx: number;
  onWorkspaceToolsWidthPxChange: (next: number) => void;
  gitChipBusy: boolean;
};

export type ConversationViewProps = {
  useMicaBackdrop: boolean;
  isEmptySession: boolean;
  hideStaleConversationMessages: boolean;
  snapshot: DesktopSnapshot | null;
  subagentViewActive: boolean;
  onExitSubagentViewer: (() => void) | undefined;
  onNewSession: (() => void) | undefined;
  newSessionBusy: boolean;
  compactionDemoActive: boolean;
  onCompactionDemoStop: () => void;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftClear: () => void;
  conversationScrollBedPaddingPx: number;
  list: ConversationListSectionProps;
  composerDock: ComposerDockSectionProps;
  workspaceTools: WorkspaceToolsSectionProps;
};

export function ConversationView({
  useMicaBackdrop,
  isEmptySession,
  hideStaleConversationMessages,
  snapshot,
  subagentViewActive,
  onExitSubagentViewer,
  onNewSession,
  newSessionBusy,
  compactionDemoActive,
  onCompactionDemoStop,
  rewindDraft,
  onRewindDraftClear,
  conversationScrollBedPaddingPx,
  list,
  composerDock,
  workspaceTools,
}: ConversationViewProps) {
  const { t } = useTranslation();

  return (
    <div data-spirit-surface="conversation-layout" className={cn("flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden min-w-0", desktopMicaTintInnerClass(useMicaBackdrop))}>
      <div data-spirit-surface="conversation-shell" className={cn("flex min-h-0 min-w-0 flex-1 flex-col min-w-0", desktopMicaTintInnerClass(useMicaBackdrop))}>
        <DesktopLayoutChromeBar
          useMicaBackdrop={useMicaBackdrop}
          showWorkspaceToggle
          workspaceToolsOpen={workspaceTools.open}
          onToggleWorkspaceTools={workspaceTools.onToggle}
          sessionTitle={
            isEmptySession || hideStaleConversationMessages
              ? null
              : snapshot?.activeSession?.displayName
          }
          subagentPromptText={
            subagentViewActive ? snapshot?.subagentViewer?.promptText : null
          }
          onExitSubagentViewer={onExitSubagentViewer}
          onNewSession={isEmptySession ? undefined : onNewSession}
          newSessionBusy={newSessionBusy}
        />
        <div data-spirit-surface="conversation-stage" className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col text-sm", desktopMicaTintClass(useMicaBackdrop))}>
          {compactionDemoActive ? (
            <div
              data-spirit-surface="compaction-ui-demo-banner"
              className={cn("shrink-0", desktopMicaTintInnerClass(useMicaBackdrop))}
            >
              <div
                className={cn(
                  "mx-auto flex w-full flex-wrap items-center justify-between gap-2 py-2",
                  CONVERSATION_GUTTER_X,
                  CONVERSATION_MAX_W,
                )}
              >
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t('app.compactionDemo')}</span>
                  <span className="hidden sm:inline">
                    {" "}
                    · {t('app.compactionDemoDescription')}
                  </span>
                </p>
                <Button type="button" variant="outline" size="sm" onClick={onCompactionDemoStop}>
                  {t('app.exitDemo')}
                </Button>
              </div>
            </div>
          ) : null}
          {rewindDraft ? (
            <button
              type="button"
              aria-label={t('app.cancelRewind')}
              className="fixed inset-0 z-30 cursor-default bg-background/35 backdrop-blur-sm"
              onClick={onRewindDraftClear}
            />
          ) : null}
          <ScrollArea
            data-spirit-surface="conversation-scroll"
            className={cn("min-h-0 flex-1", desktopMicaTintInnerClass(useMicaBackdrop))}
            type="hover"
            scrollHideDelay={450}
          >
            {/* min-h-full：短内容仍铺满视口；pb ≥ dock 实测高度 + 留白，审批卡弹出时同步增高 */}
            <div
              data-spirit-surface="conversation-scroll-body"
              className={cn("min-h-full w-full", desktopMicaTintInnerClass(useMicaBackdrop))}
              style={
                (!isEmptySession || subagentViewActive) && !hideStaleConversationMessages
                  ? { paddingBottom: conversationScrollBedPaddingPx }
                  : undefined
              }
            >
              {(!isEmptySession || subagentViewActive) && !hideStaleConversationMessages ? (
                <ConversationList
                  messages={list.messages}
                  conversationRenderItems={list.conversationRenderItems}
                  subagentViewActive={subagentViewActive}
                  composerSessionKey={list.composerSessionKey}
                  conversationListScopeKey={list.conversationListScopeKey}
                  conversationListRemountEpoch={list.conversationListRemountEpoch}
                  conversationPendingAuxState={list.conversationPendingAuxState}
                  processGroupManualOpen={list.processGroupManualOpen}
                  processGroupManualOpenKey={list.processGroupManualOpenKey}
                  onProcessGroupManualOpenChange={list.onProcessGroupManualOpenChange}
                  shouldPlayProcessSealAnimation={list.shouldPlayProcessSealAnimation}
                  workspaceRoot={snapshot?.workspaceRoot ?? ""}
                  runtime={list.runtime}
                  turnContinue={list.turnContinue}
                  activeSessionReadOnly={list.activeSessionReadOnly}
                  conversationIsBusy={snapshot?.conversation.isBusy === true}
                  continueBusy={list.continueBusy}
                  rewindDraft={list.rewindDraft}
                  onRewindDraftChange={list.onRewindDraftChange}
                  messageRewindComposerEnabled={list.messageRewindComposerEnabled}
                  rewindRichInputRef={list.rewindRichInputRef}
                  models={list.models}
                  catalogHints={snapshot?.config.modelCatalogHints}
                  activeModel={list.runtime.settings.activeModel}
                  agentMode={list.runtime.settings.agentMode}
                  onOpenSubagentViewer={list.onOpenSubagentViewer}
                  onStartMessageRewind={list.onStartMessageRewind}
                  onForkMessage={list.onForkMessage}
                  onSubmitMessageRewind={list.onSubmitMessageRewind}
                  onRewindRemoveLocalFileAttachment={list.onRewindRemoveLocalFileAttachment}
                  onRewindPickLocalFile={list.onRewindPickLocalFile}
                  onRewindPaste={list.onRewindPaste}
                  onComposerAgentModeChange={list.onComposerAgentModeChange}
                />
              ) : null}
            </div>
          </ScrollArea>

          <ComposerDock
            ref={composerDock.composerDockRef}
            isEmptySession={isEmptySession}
            emptySessionGreeting={composerDock.emptySessionGreeting}
            showWorkspaceBindingControls={composerDock.showWorkspaceBindingControls}
            snapshot={snapshot}
            runtime={list.runtime}
            commitBusy={composerDock.commitBusy}
            activeSessionReadOnly={list.activeSessionReadOnly}
            rewindWarnings={composerDock.rewindWarnings}
            showPendingApprovalInComposer={composerDock.showPendingApprovalInComposer}
            pendingApproval={composerDock.pendingApproval}
            showPendingQuestionsInComposer={composerDock.showPendingQuestionsInComposer}
            fileReferenceSuggestions={composerDock.fileReferenceSuggestions}
            fileReferenceSelectedIndex={composerDock.fileReferenceSelectedIndex}
            onFileReferenceSelectedIndexChange={composerDock.onFileReferenceSelectedIndexChange}
            onApplyFileReferenceSuggestion={composerDock.onApplyFileReferenceSuggestion}
            slashQuery={composerDock.slashQuery}
            slashSuggestions={composerDock.slashSuggestions}
            slashSelectedIndex={composerDock.slashSelectedIndex}
            onSlashSelectedIndexChange={composerDock.onSlashSelectedIndexChange}
            onApplySlashSuggestionItem={composerDock.onApplySlashSuggestionItem}
            composerPlaceholder={composerDock.composerPlaceholder}
            composerCanSend={composerDock.composerCanSend}
            conversationInterruptible={composerDock.conversationInterruptible}
            continueBusy={list.continueBusy}
            composerBrowserElementAttachments={composerDock.composerBrowserElementAttachments}
            onComposerBrowserElementAttachmentsChange={composerDock.onComposerBrowserElementAttachmentsChange}
            onSubmitComposerMessage={composerDock.onSubmitComposerMessage}
            onComposerAgentModeChange={composerDock.onComposerAgentModeChange}
            composerRichInputRef={composerDock.composerRichInputRef}
            onComposerKeyDown={composerDock.onComposerKeyDown}
            onComposerCursorCodeUnitsChange={composerDock.onComposerCursorCodeUnitsChange}
            onInsertFileReferenceTrigger={composerDock.onInsertFileReferenceTrigger}
            onPickLocalFileFromPalette={composerDock.onPickLocalFileFromPalette}
            onInsertSkillTriggerFromPalette={composerDock.onInsertSkillTriggerFromPalette}
            onRemoveLocalFileAttachment={composerDock.onRemoveLocalFileAttachment}
            onComposerPaste={composerDock.onComposerPaste}
            models={composerDock.models}
            useMicaBackdrop={useMicaBackdrop}
          />
        </div>
      </div>
      <div data-spirit-surface="workspace-dock">
        <WorkspaceToolsDock
          useMicaBackdrop={useMicaBackdrop}
          workspaceRoot={snapshot?.workspaceRoot ?? ""}
          listExplorerChildren={list.runtime.listWorkspaceExplorerChildren}
          readWorkspaceTextFile={list.runtime.readWorkspaceTextFile}
          writeWorkspaceTextFile={list.runtime.writeWorkspaceTextFile}
          readHostTextFile={list.runtime.readHostTextFile}
          writeHostTextFile={list.runtime.writeHostTextFile}
          readManagedImagePreviewDataUrl={list.runtime.readManagedImagePreviewDataUrl}
          plan={snapshot?.plan ?? { path: "", exists: false }}
          onStartImplementing={() => {
            composerDock.onComposerAgentModeChange("agent");
            void list.runtime.submitStartImplementing();
          }}
          startImplementingDisabled={
            workspaceTools.startImplementingDisabled || !snapshot?.plan?.exists
          }
          autoRevealPlanNonce={workspaceTools.workspaceFilesPlanRevealNonce}
          planRevealTabId={workspaceTools.workspaceFilesPlanRevealTargetId}
          autoRevealFileNonce={workspaceTools.workspaceFileRevealNonce}
          fileRevealTabId={workspaceTools.workspaceFileRevealTargetId}
          fileRevealPath={workspaceTools.workspaceFileRevealPath}
          fileRevealAbsolutePath={workspaceTools.workspaceFileRevealAbsolutePath}
          fileRevealScope={workspaceTools.workspaceFileRevealScope}
          fileRevealViewMode={workspaceTools.workspaceFileRevealViewMode}
          onOpenWorkspaceFile={workspaceTools.onOpenWorkspaceFile}
          tabs={workspaceTools.workspaceToolTabs}
          activeTabId={workspaceTools.activeWorkspaceToolTabId}
          onTabsChange={workspaceTools.onWorkspaceToolTabsChange}
          onActiveTabIdChange={workspaceTools.onActiveWorkspaceToolTabIdChange}
          onBrowserElementPicked={workspaceTools.onBrowserElementPicked}
          onBrowserOpenInNewTab={workspaceTools.onBrowserOpenInNewTab}
          browserTabEnabled={workspaceTools.browserTabEnabled}
          prTabEnabled={workspaceTools.prTabEnabled}
          getGitHubAuthStatus={list.runtime.getGitHubAuthStatus}
          beginGitHubDeviceLogin={list.runtime.beginGitHubDeviceLogin}
          completeGitHubDeviceLogin={list.runtime.completeGitHubDeviceLogin}
          cancelGitHubDeviceLogin={list.runtime.cancelGitHubDeviceLogin}
          disconnectGitHub={list.runtime.disconnectGitHub}
          getGitHubPullRequestForCurrentBranch={list.runtime.getGitHubPullRequestForCurrentBranch}
          getGitHubPullRequestDetail={list.runtime.getGitHubPullRequestDetail}
          open={workspaceTools.open}
          widthPx={workspaceTools.workspaceToolsWidthPx}
          onWidthPxChange={workspaceTools.onWorkspaceToolsWidthPxChange}
          gitSnapshot={snapshot?.git}
          gitChipBusy={workspaceTools.gitChipBusy}
          readGitWorkingTree={list.runtime.readGitWorkingTree}
          readGitHistory={list.runtime.readGitHistory}
          submitGitChip={list.runtime.submitGitChip}
        />
      </div>
    </div>
  );
}
