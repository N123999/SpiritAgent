import {
  forwardRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import { BranchSelectMenu } from "@/components/branch-select-menu";
import { ComposerSurface } from "@/components/composer/composer-surface";
import { ComposerChangesCard } from "@/components/composer-changes-card";
import { ComposerContextUsageRing } from "@/components/composer-context-usage-ring";
import { ComposerTodoCard } from "@/components/composer-todo-card";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { EmptyStateWorkspaceSelector } from "@/components/empty-state-workspace-selector";
import { PendingApprovalCard } from "@/components/pending-approval-card";
import { PendingQuestionsCard } from "@/components/pending-questions-card";
import { SkillSlashMenu } from "@/components/skill-slash-menu";
import { WorkLocationMenu } from "@/components/work-location-menu";
import { WorkspaceFileReferenceMenu } from "@/components/workspace-file-reference-menu";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  CONVERSATION_GUTTER_NEG_X,
  CONVERSATION_GUTTER_X,
  CONVERSATION_MAX_W,
} from "@/lib/conversation-layout-constants";
import { desktopMicaTintInnerClass } from "@/lib/desktop-mica-surface";
import type { ActiveSkillSlashQuery, SkillSlashSuggestion } from "@/lib/skill-slash";
import { sameWorkspacePath } from "@/lib/workspace-display-label";
import { shouldShowComposerChangesCard } from "@/lib/composer-changes-card-visibility";
import { cn } from "@/lib/utils";
import type {
  DesktopSnapshot,
  WorkspaceFileReferenceSuggestionsResponse,
} from "@/types";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type ComposerDockProps = {
  isEmptySession: boolean;
  emptySessionGreeting: string;
  showWorkspaceBindingControls: boolean;
  snapshot: DesktopSnapshot | null;
  runtime: DesktopRuntime;
  commitBusy: boolean;
  activeSessionReadOnly: boolean;
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
  continueBusy: boolean;
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
  onComposerDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  onComposerDrop: (event: ReactDragEvent<HTMLElement>) => void;
  models: DesktopSnapshot["config"]["models"];
  useMicaBackdrop: boolean;
  onOpenGitTab: () => void;
};

export const ComposerDock = forwardRef<HTMLDivElement, ComposerDockProps>(function ComposerDock(
  {
    isEmptySession,
    emptySessionGreeting,
    showWorkspaceBindingControls,
    snapshot,
    runtime,
    commitBusy,
    activeSessionReadOnly,
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
    continueBusy,
    composerBrowserElementAttachments,
    onComposerBrowserElementAttachmentsChange,
    onSubmitComposerMessage,
    onComposerAgentModeChange,
    composerRichInputRef,
    onComposerKeyDown,
    onComposerCursorCodeUnitsChange,
    onInsertFileReferenceTrigger,
    onPickLocalFileFromPalette,
    onInsertSkillTriggerFromPalette,
    onRemoveLocalFileAttachment,
    onComposerPaste,
    onComposerDragOver,
    onComposerDrop,
    models,
    useMicaBackdrop,
    onOpenGitTab,
  },
  ref,
) {
  const { t } = useTranslation();
  const showChangesCard = shouldShowComposerChangesCard(snapshot?.git);
  const changesLineDelta = snapshot?.git.workingTreeLineDelta;
  const hasComposerTodos = Boolean(snapshot?.conversation.todos);

  return (
    <div
      ref={ref}
      data-spirit-surface="composer-dock"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-10 bg-transparent",
        isEmptySession
          ? cn(
              "inset-y-0 flex items-center justify-center pb-[env(safe-area-inset-bottom,0px)]",
              CONVERSATION_GUTTER_X,
            )
          : "bottom-0 pt-2 pb-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto w-full",
          CONVERSATION_GUTTER_X,
          CONVERSATION_MAX_W,
        )}
      >
        {isEmptySession ? (
          <div data-spirit-surface="conversation-empty">
            <p
              className="mb-6 text-center text-2xl font-medium tracking-tight text-foreground sm:text-3xl"
              data-testid="empty-session-greeting"
            >
              {emptySessionGreeting}
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          {showWorkspaceBindingControls ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5">
              <EmptyStateWorkspaceSelector
                currentWorkspaceRoot={snapshot?.workspaceRoot ?? ""}
                workspaceBinding={snapshot?.workspaceBinding ?? "project"}
                availableWorkspaces={snapshot?.availableWorkspaces ?? []}
                disabled={runtime.busyAction === "bootstrap" || runtime.busyAction === "session"}
                onSelectWorkspace={(workspaceRoot) => {
                  if (
                    snapshot?.workspaceBinding === "project"
                    && snapshot.workspaceRoot
                    && sameWorkspacePath(snapshot.workspaceRoot, workspaceRoot)
                  ) {
                    return;
                  }
                  void runtime.switchWorkspaceRoot(workspaceRoot);
                }}
                onSelectNoWorkspace={() => {
                  if (snapshot?.workspaceBinding === "none") {
                    return;
                  }
                  void runtime.switchToNoWorkspaceBinding();
                }}
                onAddWorkspace={() => {
                  void (async () => {
                    const workspaceRoot = await runtime.pickWorkspaceDirectory();
                    if (!workspaceRoot) {
                      return;
                    }
                    await runtime.switchWorkspaceRoot(workspaceRoot);
                  })();
                }}
              />
              {isEmptySession ? (
                <>
                  <BranchSelectMenu
                    branches={snapshot?.git.branches ?? []}
                    selectedBranch={snapshot?.git.selectedBranch}
                    currentBranch={snapshot?.git.branch}
                    disabled={
                      runtime.busyAction === "bootstrap"
                      || runtime.busyAction === "session"
                      || commitBusy
                    }
                    onBranchChange={(branch) => {
                      void runtime.setPendingGitBranch(branch);
                    }}
                  />
                  <WorkLocationMenu
                    workLocation={snapshot?.git.workLocation ?? "local"}
                    disabled={
                      runtime.busyAction === "bootstrap"
                      || runtime.busyAction === "session"
                      || commitBusy
                      || snapshot?.git.isRepository !== true
                    }
                    onWorkLocationChange={(workLocation) => {
                      void runtime.setWorkLocation(workLocation);
                    }}
                  />
                  <ApprovalLevelMenu
                    approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                    disabled={activeSessionReadOnly}
                    onApprovalLevelChange={(level) => {
                      void runtime.setApprovalLevel(level);
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}

          {rewindWarnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
              <p>{t('app.rewindComplete', { count: rewindWarnings.length })}</p>
              <p className="mt-1 truncate" title={rewindWarnings[0]?.message}>
                {rewindWarnings[0]?.path}: {rewindWarnings[0]?.message}
              </p>
            </div>
          ) : null}

          {showPendingApprovalInComposer && pendingApproval ? (
            <PendingApprovalCard
              pendingApproval={pendingApproval}
              approvalGuidance={runtime.approvalGuidance}
              approveBusy={runtime.busyAction === "approve"}
              onApprovalGuidanceChange={runtime.setApprovalGuidance}
              onSubmitApproval={(decision) => {
                if (decision.kind === "allow") {
                  void runtime.submitApproval({
                    kind: "allow",
                    ...(decision.persistTrust ? { persistTrust: true } : {}),
                  });
                  return;
                }
                if (decision.kind === "deny") {
                  void runtime.submitApproval({ kind: "deny" });
                  return;
                }
                void runtime.submitApproval({
                  kind: "guidance",
                  userMessage: decision.userMessage ?? "",
                });
              }}
            />
          ) : null}

          {showPendingQuestionsInComposer && runtime.pendingQuestions ? (
            <PendingQuestionsCard
              pendingQuestions={runtime.pendingQuestions}
              questionDrafts={runtime.questionDrafts}
              questionsBusy={runtime.busyAction === "questions"}
              onUpdateDraft={runtime.updateQuestionDraft}
              onSubmitQuestions={() => void runtime.submitQuestions()}
              onSkipQuestions={() => void runtime.skipQuestions()}
            />
          ) : null}

          <div className="relative">
            <div className="relative z-10 flex flex-col">
              {!isEmptySession && showChangesCard && changesLineDelta ? (
                <div
                  className={cn(
                    "relative z-20 mb-2 shrink-0 self-start",
                    hasComposerTodos && "mx-4",
                  )}
                >
                  <ComposerChangesCard delta={changesLineDelta} onOpenGitTab={onOpenGitTab} />
                </div>
              ) : null}
              {snapshot?.conversation.todos ? (
                <div className="relative z-20 mx-4 -mb-px shrink-0">
                  <ComposerTodoCard
                    todos={snapshot.conversation.todos}
                    sessionKey={snapshot.composerSessionKey}
                  />
                </div>
              ) : null}
              {fileReferenceSuggestions ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 pb-2">
                  <div className="pointer-events-auto">
                    <WorkspaceFileReferenceMenu
                      suggestions={fileReferenceSuggestions.suggestions}
                      selectedIndex={fileReferenceSelectedIndex}
                      onSelectIndex={onFileReferenceSelectedIndexChange}
                      onApplySuggestion={onApplyFileReferenceSuggestion}
                    />
                  </div>
                </div>
              ) : null}
              {slashQuery ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 pb-2">
                  <div className="pointer-events-auto">
                    <SkillSlashMenu
                      suggestions={slashSuggestions}
                      selectedIndex={slashSelectedIndex}
                      onSelectIndex={onSlashSelectedIndexChange}
                      onApplySuggestion={onApplySlashSuggestionItem}
                    />
                  </div>
                </div>
              ) : null}
              <ComposerSurface
                value={runtime.composer}
                onChange={runtime.setComposer}
                onSubmit={onSubmitComposerMessage}
                browserElementAttachments={composerBrowserElementAttachments}
                onElementAttachmentsChange={onComposerBrowserElementAttachmentsChange}
                onAbort={() => void runtime.abortConversation()}
                placeholder={composerPlaceholder}
                localFileAttachments={runtime.composerLocalFileAttachments}
                models={models}
                catalogHints={snapshot?.config.modelCatalogHints}
                activeModel={runtime.settings.activeModel}
                agentMode={runtime.settings.agentMode}
                loopEnabled={snapshot?.conversation.loopEnabled === true}
                onModelSelect={runtime.setActiveModel}
                onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                onModelThinkingEnabledSelect={runtime.setModelThinkingEnabled}
                onAgentModeChange={onComposerAgentModeChange}
                onLoopEnabledChange={(enabled) => {
                  void runtime.setLoopEnabled(enabled);
                }}
                richInputRef={composerRichInputRef}
                onKeyDown={onComposerKeyDown}
                onSelectionChange={(selectionStart) => {
                  if (selectionStart !== null) {
                    onComposerCursorCodeUnitsChange(selectionStart);
                  }
                }}
                canSend={composerCanSend}
                canAbort={conversationInterruptible}
                busy={runtime.busyAction === "send"}
                conversationBusy={continueBusy}
                agentModeChipDismissed={runtime.agentModeChipDismissed}
                onAgentModeChipDismissChange={runtime.setAgentModeChipDismissed}
                readOnly={activeSessionReadOnly}
                showInsertButton
                canPickLocalFile={runtime.hostKind === "electron"}
                onInsertWorkspaceFileReferenceTrigger={onInsertFileReferenceTrigger}
                onPickLocalFile={onPickLocalFileFromPalette}
                onInsertSkillTrigger={onInsertSkillTriggerFromPalette}
                onRemoveLocalFileAttachment={onRemoveLocalFileAttachment}
                onPaste={onComposerPaste}
                onDragOver={onComposerDragOver}
                onDrop={onComposerDrop}
                saveLocalImageAs={runtime.saveLocalImageAs}
              />
            </div>
            {!isEmptySession ? (
              <div
                className={cn(
                  "pointer-events-none relative z-0 -mt-4 pt-[calc(1rem+0.375rem)] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
                  desktopMicaTintInnerClass(useMicaBackdrop),
                  CONVERSATION_GUTTER_NEG_X,
                  CONVERSATION_GUTTER_X,
                )}
              >
                <div className="pointer-events-auto relative z-[11] flex items-center justify-between gap-3 px-3">
                  <ApprovalLevelMenu
                    approvalLevel={snapshot?.conversation.approvalLevel ?? "default"}
                    disabled={activeSessionReadOnly}
                    onApprovalLevelChange={(level) => {
                      void runtime.setApprovalLevel(level);
                    }}
                  />
                  <ComposerContextUsageRing
                    usage={snapshot?.conversation.contextUsage}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
