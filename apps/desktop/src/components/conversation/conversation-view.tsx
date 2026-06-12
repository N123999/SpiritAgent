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

export type ConversationViewProps = {
  useMicaBackdrop: boolean;
  workspaceToolsOpen: boolean;
  onToggleWorkspaceTools: () => void;
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
  composerDockRef: Ref<HTMLDivElement | null>;
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
  onRewindDraftChange: (
    updater: (current: MessageRewindDraftState | null) => MessageRewindDraftState | null,
  ) => void;
  messageRewindComposerEnabled: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  models: DesktopSnapshot["config"]["models"];
  onOpenSubagentViewer: ((toolCallId: string) => void) | undefined;
  onStartMessageRewind: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onSubmitMessageRewind: () => void;
  onRewindRemoveLocalFileAttachment: (path: string) => void;
  onRewindPickLocalFile: () => void;
  onRewindPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
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
  composerRichInputRef: RefObject<ComposerRichInputHandle | null>;
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onComposerCursorCodeUnitsChange: (selectionStart: number) => void;
  onInsertFileReferenceTrigger: () => void;
  onPickLocalFileFromPalette: () => void;
  onInsertSkillTriggerFromPalette: () => void;
  onRemoveLocalFileAttachment: (path: string) => void;
  onComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
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
  workspaceToolsWidthPx: number;
  onWorkspaceToolsWidthPxChange: (next: number) => void;
  gitChipBusy: boolean;
};

export function ConversationView({
  useMicaBackdrop,
  workspaceToolsOpen,
  onToggleWorkspaceTools,
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
  composerDockRef,
  messages,
  conversationRenderItems,
  composerSessionKey,
  conversationListScopeKey,
  conversationListRemountEpoch,
  conversationPendingAuxState,
  processGroupManualOpen,
  processGroupManualOpenKey,
  onProcessGroupManualOpenChange,
  shouldPlayProcessSealAnimation,
  runtime,
  turnContinue,
  activeSessionReadOnly,
  continueBusy,
  onRewindDraftChange,
  messageRewindComposerEnabled,
  rewindRichInputRef,
  models,
  onOpenSubagentViewer,
  onStartMessageRewind,
  onSubmitMessageRewind,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onComposerAgentModeChange,
  emptySessionGreeting,
  showWorkspaceBindingControls,
  commitBusy,
  rewindWarnings,
  showPendingApprovalInComposer,
  pendingApproval,
  showPendingQuestionsInComposer,
  fileReferenceSuggestions,
  fileReferenceSelectedIndex,
  onFileReferenceSelectedIndexChange,
  onApplyFileReferenceSuggestion,
  slashQuery,
  slashSuggestions,
  slashSelectedIndex,
  onSlashSelectedIndexChange,
  onApplySlashSuggestionItem,
  composerPlaceholder,
  composerCanSend,
  conversationInterruptible,
  composerBrowserElementAttachments,
  onComposerBrowserElementAttachmentsChange,
  onSubmitComposerMessage,
  composerRichInputRef,
  onComposerKeyDown,
  onComposerCursorCodeUnitsChange,
  onInsertFileReferenceTrigger,
  onPickLocalFileFromPalette,
  onInsertSkillTriggerFromPalette,
  onRemoveLocalFileAttachment,
  onComposerPaste,
  startImplementingDisabled,
  workspaceFilesPlanRevealNonce,
  workspaceFilesPlanRevealTargetId,
  workspaceFileRevealNonce,
  workspaceFileRevealTargetId,
  workspaceFileRevealPath,
  workspaceFileRevealAbsolutePath,
  workspaceFileRevealScope,
  workspaceFileRevealViewMode,
  onOpenWorkspaceFile,
  workspaceToolTabs,
  activeWorkspaceToolTabId,
  onWorkspaceToolTabsChange,
  onActiveWorkspaceToolTabIdChange,
  onBrowserElementPicked,
  onBrowserOpenInNewTab,
  browserTabEnabled,
  workspaceToolsWidthPx,
  onWorkspaceToolsWidthPxChange,
  gitChipBusy,
}: ConversationViewProps) {
  const { t } = useTranslation();

  return (
    <div data-spirit-surface="conversation-layout" className={cn("flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden min-w-0", desktopMicaTintInnerClass(useMicaBackdrop))}>
      <div data-spirit-surface="conversation-shell" className={cn("flex min-h-0 min-w-0 flex-1 flex-col min-w-0", desktopMicaTintInnerClass(useMicaBackdrop))}>
        <DesktopLayoutChromeBar
          useMicaBackdrop={useMicaBackdrop}
          showWorkspaceToggle
          workspaceToolsOpen={workspaceToolsOpen}
          onToggleWorkspaceTools={onToggleWorkspaceTools}
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
                  messages={messages}
                  conversationRenderItems={conversationRenderItems}
                  subagentViewActive={subagentViewActive}
                  composerSessionKey={composerSessionKey}
                  conversationListScopeKey={conversationListScopeKey}
                  conversationListRemountEpoch={conversationListRemountEpoch}
                  conversationPendingAuxState={conversationPendingAuxState}
                  processGroupManualOpen={processGroupManualOpen}
                  processGroupManualOpenKey={processGroupManualOpenKey}
                  onProcessGroupManualOpenChange={onProcessGroupManualOpenChange}
                  shouldPlayProcessSealAnimation={shouldPlayProcessSealAnimation}
                  workspaceRoot={snapshot?.workspaceRoot ?? ""}
                  runtime={runtime}
                  turnContinue={turnContinue}
                  activeSessionReadOnly={activeSessionReadOnly}
                  conversationIsBusy={snapshot?.conversation.isBusy === true}
                  continueBusy={continueBusy}
                  rewindDraft={rewindDraft}
                  onRewindDraftChange={onRewindDraftChange}
                  messageRewindComposerEnabled={messageRewindComposerEnabled}
                  rewindRichInputRef={rewindRichInputRef}
                  models={models}
                  catalogHints={snapshot?.config.modelCatalogHints}
                  activeModel={runtime.settings.activeModel}
                  agentMode={runtime.settings.agentMode}
                  onOpenSubagentViewer={onOpenSubagentViewer}
                  onStartMessageRewind={onStartMessageRewind}
                  onSubmitMessageRewind={onSubmitMessageRewind}
                  onRewindRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
                  onRewindPickLocalFile={onRewindPickLocalFile}
                  onRewindPaste={onRewindPaste}
                  onComposerAgentModeChange={onComposerAgentModeChange}
                />
              ) : null}
            </div>
          </ScrollArea>

          <ComposerDock
            ref={composerDockRef}
            isEmptySession={isEmptySession}
            emptySessionGreeting={emptySessionGreeting}
            showWorkspaceBindingControls={showWorkspaceBindingControls}
            snapshot={snapshot}
            runtime={runtime}
            commitBusy={commitBusy}
            activeSessionReadOnly={activeSessionReadOnly}
            rewindWarnings={rewindWarnings}
            showPendingApprovalInComposer={showPendingApprovalInComposer}
            pendingApproval={pendingApproval}
            showPendingQuestionsInComposer={showPendingQuestionsInComposer}
            fileReferenceSuggestions={fileReferenceSuggestions}
            fileReferenceSelectedIndex={fileReferenceSelectedIndex}
            onFileReferenceSelectedIndexChange={onFileReferenceSelectedIndexChange}
            onApplyFileReferenceSuggestion={onApplyFileReferenceSuggestion}
            slashQuery={slashQuery}
            slashSuggestions={slashSuggestions}
            slashSelectedIndex={slashSelectedIndex}
            onSlashSelectedIndexChange={onSlashSelectedIndexChange}
            onApplySlashSuggestionItem={onApplySlashSuggestionItem}
            composerPlaceholder={composerPlaceholder}
            composerCanSend={composerCanSend}
            conversationInterruptible={conversationInterruptible}
            continueBusy={continueBusy}
            composerBrowserElementAttachments={composerBrowserElementAttachments}
            onComposerBrowserElementAttachmentsChange={onComposerBrowserElementAttachmentsChange}
            onSubmitComposerMessage={onSubmitComposerMessage}
            onComposerAgentModeChange={onComposerAgentModeChange}
            composerRichInputRef={composerRichInputRef}
            onComposerKeyDown={onComposerKeyDown}
            onComposerCursorCodeUnitsChange={onComposerCursorCodeUnitsChange}
            onInsertFileReferenceTrigger={onInsertFileReferenceTrigger}
            onPickLocalFileFromPalette={onPickLocalFileFromPalette}
            onInsertSkillTriggerFromPalette={onInsertSkillTriggerFromPalette}
            onRemoveLocalFileAttachment={onRemoveLocalFileAttachment}
            onComposerPaste={onComposerPaste}
            models={models}
            useMicaBackdrop={useMicaBackdrop}
          />
        </div>
      </div>
      <div data-spirit-surface="workspace-dock">
        <WorkspaceToolsDock
          useMicaBackdrop={useMicaBackdrop}
          workspaceRoot={snapshot?.workspaceRoot ?? ""}
          listExplorerChildren={runtime.listWorkspaceExplorerChildren}
          readWorkspaceTextFile={runtime.readWorkspaceTextFile}
          writeWorkspaceTextFile={runtime.writeWorkspaceTextFile}
          readHostTextFile={runtime.readHostTextFile}
          writeHostTextFile={runtime.writeHostTextFile}
          readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
          plan={snapshot?.plan ?? { path: "", exists: false }}
          onStartImplementing={() => {
            onComposerAgentModeChange("agent");
            void runtime.submitStartImplementing();
          }}
          startImplementingDisabled={
            startImplementingDisabled || !snapshot?.plan?.exists
          }
          autoRevealPlanNonce={workspaceFilesPlanRevealNonce}
          planRevealTabId={workspaceFilesPlanRevealTargetId}
          autoRevealFileNonce={workspaceFileRevealNonce}
          fileRevealTabId={workspaceFileRevealTargetId}
          fileRevealPath={workspaceFileRevealPath}
          fileRevealAbsolutePath={workspaceFileRevealAbsolutePath}
          fileRevealScope={workspaceFileRevealScope}
          fileRevealViewMode={workspaceFileRevealViewMode}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          tabs={workspaceToolTabs}
          activeTabId={activeWorkspaceToolTabId}
          onTabsChange={onWorkspaceToolTabsChange}
          onActiveTabIdChange={onActiveWorkspaceToolTabIdChange}
          onBrowserElementPicked={onBrowserElementPicked}
          onBrowserOpenInNewTab={onBrowserOpenInNewTab}
          browserTabEnabled={browserTabEnabled}
          open={workspaceToolsOpen}
          widthPx={workspaceToolsWidthPx}
          onWidthPxChange={onWorkspaceToolsWidthPxChange}
          gitSnapshot={snapshot?.git}
          gitChipBusy={gitChipBusy}
          readGitWorkingTree={runtime.readGitWorkingTree}
          readGitHistory={runtime.readGitHistory}
          submitGitChip={runtime.submitGitChip}
        />
      </div>
    </div>
  );
}
