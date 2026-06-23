import { useTranslation } from "react-i18next";

import { ProcessCardCollapsible } from "@/components/process-card-collapsible";
import { ToolCallDiffHostProvider } from "@/components/tool-call-diff-host-context";
import { ToolCallCollapsible } from "@/components/tool-call/tool-call-collapsible";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { MessageCard } from "@/components/conversation/message-card";
import { MessageTurnActions } from "@/components/conversation/message-turn-actions";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { conversationMessageStableId } from "@/lib/conversation-list-scope";
import {
  shouldShowContinueToolbarOnProcessGroup,
  type TurnContinuePresentation,
} from "@/lib/conversation-continue-ui";
import {
  isMessageHiddenByProcessGroup,
  type ConversationRenderItem,
} from "@/lib/conversation-process-groups";
import {
  shouldCompactAfterPreviousRenderItem,
  shouldTightenAfterPreviousRenderItem,
} from "@/lib/message-card-spacing";
import {
  assistantTurnStartIndexForRenderItem,
  resolveTurnActionsToolbarHostIndex,
  shouldClearAssistantTurnHover,
} from "@/lib/message-turn-actions-ui";
import { cn } from "@/lib/utils";
import type {
  ConversationMessageSnapshot,
  DesktopSnapshot,
  MessageRewindDraftState,
  PendingAssistantAux,
} from "@/types";
import type { PointerEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MAX_W,
} from "@/lib/conversation-layout-constants";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type ConversationListProps = {
  messages: readonly ConversationMessageSnapshot[];
  conversationRenderItems: readonly ConversationRenderItem[];
  subagentViewActive: boolean;
  composerSessionKey: string;
  conversationListScopeKey: string;
  conversationListRemountEpoch: number;
  conversationPendingAuxState: PendingAssistantAux | undefined;
  processGroupManualOpen: Record<string, boolean>;
  processGroupManualOpenKey: (groupId: string) => string;
  onProcessGroupManualOpenChange: (groupId: string, open: boolean) => void;
  shouldPlayProcessSealAnimation: (groupId: string) => boolean;
  workspaceRoot: string;
  runtime: DesktopRuntime;
  turnContinue: TurnContinuePresentation | undefined;
  activeSessionReadOnly: boolean;
  conversationIsBusy: boolean;
  continueBusy: boolean;
  rewindDraft: MessageRewindDraftState | null;
  onRewindDraftChange: (
    updater: (current: MessageRewindDraftState | null) => MessageRewindDraftState | null,
  ) => void;
  messageRewindComposerEnabled: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  models: DesktopSnapshot["config"]["models"];
  catalogHints: DesktopSnapshot["config"]["modelCatalogHints"] | undefined;
  activeModel: string;
  agentMode: DesktopAgentMode;
  onOpenSubagentViewer: ((toolCallId: string) => void) | undefined;
  onStartMessageRewind: (message: ConversationMessageSnapshot, listIndex: number) => void;
  onSubmitMessageRewind: () => void;
  onRewindRemoveLocalFileAttachment: (path: string) => void;
  onRewindPickLocalFile: () => void;
  onRewindPaste: (event: import("react").ClipboardEvent<HTMLTextAreaElement>) => void;
  onComposerAgentModeChange: (mode: DesktopAgentMode) => void;
  onForkMessage: (message: ConversationMessageSnapshot, listIndex: number) => void;
};

export function ConversationList({
  messages,
  conversationRenderItems,
  subagentViewActive,
  composerSessionKey,
  conversationListScopeKey,
  conversationListRemountEpoch,
  conversationPendingAuxState,
  processGroupManualOpen,
  processGroupManualOpenKey,
  onProcessGroupManualOpenChange,
  shouldPlayProcessSealAnimation,
  workspaceRoot,
  runtime,
  turnContinue,
  activeSessionReadOnly,
  conversationIsBusy,
  continueBusy,
  rewindDraft,
  onRewindDraftChange,
  messageRewindComposerEnabled,
  rewindRichInputRef,
  models,
  catalogHints,
  activeModel,
  agentMode,
  onOpenSubagentViewer,
  onStartMessageRewind,
  onSubmitMessageRewind,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onComposerAgentModeChange,
  onForkMessage,
}: ConversationListProps) {
  const { t } = useTranslation();
  const [hoveredAssistantTurnStart, setHoveredAssistantTurnStart] = useState<number | null>(
    null,
  );
  const turnActionsToolbarHostIndex = useMemo(
    () => resolveTurnActionsToolbarHostIndex(messages),
    [messages],
  );

  const handleAssistantTurnPointerEnter = useCallback((turnStart: number) => {
    setHoveredAssistantTurnStart(turnStart);
  }, []);

  const handleAssistantTurnPointerLeave = useCallback(
    (event: PointerEvent, turnStart: number) => {
      if (!shouldClearAssistantTurnHover(event, turnStart)) {
        return;
      }
      setHoveredAssistantTurnStart((current) =>
        current === turnStart ? null : current,
      );
    },
    [],
  );

  useEffect(() => {
    if (!conversationIsBusy) {
      return;
    }
    setHoveredAssistantTurnStart(null);
  }, [conversationIsBusy]);

  const toolCallDiffHostValue = useMemo(
    () => ({
      workspaceRoot,
      readWorkspaceTextFile: runtime.readWorkspaceTextFile,
    }),
    [workspaceRoot, runtime.readWorkspaceTextFile],
  );

  return (
    <div
      data-spirit-surface="conversation-list-shell"
      className={cn(
        "mx-auto w-full overflow-x-hidden pt-6 sm:pt-7",
        CONVERSATION_GUTTER_X,
        CONVERSATION_MAX_W,
      )}
    >
      <ToolCallDiffHostProvider value={toolCallDiffHostValue}>
        <div
          key={`${composerSessionKey || "__no-session__"}:${conversationListScopeKey}:e${conversationListRemountEpoch}`}
          data-spirit-surface="conversation-list"
          className="space-y-3"
        >
          {subagentViewActive && messages.length === 0 ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("app.subagentViewerEmpty")}
            </p>
          ) : null}
          {conversationRenderItems.map((renderItem, renderIndex) => {
            const previousRenderItem = conversationRenderItems[renderIndex - 1];
            const assistantTurnStart = assistantTurnStartIndexForRenderItem(renderItem, messages);
            const forkMenuHoverRevealed =
              assistantTurnStart !== null
              && hoveredAssistantTurnStart === assistantTurnStart;

            if (renderItem.kind === "process-group") {
              const anchorMessage = messages[renderItem.messageIndices[0]];
              if (!anchorMessage) {
                return null;
              }
              const compactAfterPrevious = shouldCompactAfterPreviousRenderItem(
                previousRenderItem,
                anchorMessage,
                messages,
              );
            const tightenAfterPreviousMeta = shouldTightenAfterPreviousRenderItem(
              previousRenderItem,
              anchorMessage,
              messages,
              renderItem.messageIndices[0],
            );
              const showProcessGroupContinue = shouldShowContinueToolbarOnProcessGroup(
                renderItem.messageIndices,
                messages,
                turnContinue,
                conversationIsBusy === true,
                activeSessionReadOnly,
              );
              return (
                <div
                  key={renderItem.groupId}
                  id={renderItem.groupId}
                  data-spirit-surface="message-row"
                  data-spirit-message-role="assistant"
                  data-spirit-message-pending="false"
                  data-spirit-fork-turn-start={assistantTurnStart ?? undefined}
                  onPointerEnter={
                    assistantTurnStart === null
                      ? undefined
                      : () => handleAssistantTurnPointerEnter(assistantTurnStart)
                  }
                  onPointerLeave={
                    assistantTurnStart === null
                      ? undefined
                      : (event) => handleAssistantTurnPointerLeave(event, assistantTurnStart)
                  }
                  className={cn(
                    "scroll-mt-4 flex w-full justify-start pb-3 last:pb-0",
                    compactAfterPrevious && "-mt-4",
                    tightenAfterPreviousMeta && "-mt-3",
                  )}
                >
                  <div
                    data-spirit-surface="message-assistant"
                    className="min-w-0 w-full space-y-2"
                  >
                    <ProcessCardCollapsible
                      groupId={renderItem.groupId}
                      messageIndices={renderItem.messageIndices}
                      messages={messages}
                      toolCounts={renderItem.toolCounts}
                      pendingAuxState={conversationPendingAuxState}
                      playSealAnimation={shouldPlayProcessSealAnimation(renderItem.groupId)}
                      manualOpen={processGroupManualOpen[processGroupManualOpenKey(renderItem.groupId)]}
                      onManualOpenChange={(open) => {
                        onProcessGroupManualOpenChange(renderItem.groupId, open);
                      }}
                      renderToolBlock={(message) => (
                        <ToolCallCollapsible
                          tool={message.tool!}
                          readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
                          readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
                          readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
                          saveLocalImageAs={runtime.saveLocalImageAs}
                          onOpenSubagentViewer={onOpenSubagentViewer}
                          onAbortShell={(toolCallId) => {
                            void runtime.abortShellCommand(toolCallId);
                          }}
                        />
                      )}
                      readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
                      readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
                    />
                    {showProcessGroupContinue && turnContinue ? (
                      <MessageTurnActions
                        showContinueButton
                        continueTarget={turnContinue.continuableMessage}
                        continueBusy={continueBusy}
                        onContinue={(targetMessage) => {
                          void runtime.continueAssistantCompletion(targetMessage.id);
                        }}
                        canFork={false}
                        forkBusy={false}
                        forkEnabled={false}
                        forkMenuAlwaysVisible={false}
                        onFork={() => {}}
                      />
                    ) : null}
                  </div>
                </div>
              );
            }

            const index = renderItem.messageIndex;
            const message = messages[index];
            if (!message) {
              return null;
            }
            const compactAfterPrevious = shouldCompactAfterPreviousRenderItem(
              previousRenderItem,
              message,
              messages,
            );
            const tightenAfterPreviousMeta = shouldTightenAfterPreviousRenderItem(
              previousRenderItem,
              message,
              messages,
              index,
            );
            const queuedBeforeCount = messages
              .slice(0, index)
              .filter((item) => item.queued === true).length;
            const queuedCanMoveUp =
              message.queued === true && queuedBeforeCount > 0;
            const hiddenByProcessGroup = isMessageHiddenByProcessGroup(
              conversationRenderItems,
              index,
            );
            return (
              <MessageCard
                key={`${conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}@${index}`}
                composerSessionKey={composerSessionKey}
                conversationListScopeKey={conversationListScopeKey}
                messages={messages}
                pendingAuxState={conversationPendingAuxState}
                listIndex={index}
                message={message}
                hiddenByProcessGroup={hiddenByProcessGroup}
                compactAfterPrevious={compactAfterPrevious}
                tightenAfterPreviousMeta={tightenAfterPreviousMeta}
                showContinueButton={
                  turnContinue?.showContinueAtIndex === index &&
                  !activeSessionReadOnly &&
                  conversationIsBusy !== true
                }
                continueTarget={turnContinue?.continuableMessage}
                continueBusy={continueBusy}
                rewindSelected={rewindDraft?.listIndex === index}
                rewindText={
                  rewindDraft?.listIndex === index ? rewindDraft.text : ""
                }
                rewindLocalFileAttachments={
                  rewindDraft?.listIndex === index
                    ? rewindDraft.localFileAttachments
                    : []
                }
                rewindBrowserElementAttachments={
                  rewindDraft?.listIndex === index
                    ? rewindDraft.browserElementAttachments
                    : []
                }
                rewindRichInputRef={rewindRichInputRef}
                onRewindElementAttachmentsChange={(attachments) => {
                  onRewindDraftChange((current) =>
                    current && current.listIndex === index
                      ? { ...current, browserElementAttachments: attachments }
                      : current,
                  );
                }}
                rewindCanSubmit={
                  messageRewindComposerEnabled &&
                  rewindDraft?.listIndex === index &&
                  (Boolean(rewindDraft.text.trim()) ||
                    rewindDraft.browserElementAttachments.length > 0 ||
                    rewindDraft.localFileAttachments.length > 0)
                }
                canPickLocalFile={runtime.hostKind === "electron"}
                rewindBusy={runtime.busyAction === "rewind"}
                models={models}
                catalogHints={catalogHints}
                activeModel={activeModel}
                agentMode={agentMode}
                onContinue={(targetMessage) => {
                  void runtime.continueAssistantCompletion(targetMessage.id);
                }}
                onRewindStart={onStartMessageRewind}
                onRewindChange={(value) => {
                  onRewindDraftChange((current) =>
                    current ? { ...current, text: value } : current,
                  );
                }}
                onRewindSubmit={onSubmitMessageRewind}
                onRewindRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
                onRewindPickLocalFile={onRewindPickLocalFile}
                onRewindPaste={onRewindPaste}
                onModelSelect={runtime.setActiveModel}
                onModelReasoningEffortSelect={runtime.setModelReasoningEffort}
                onAgentModeChange={onComposerAgentModeChange}
                readManagedImagePreviewDataUrl={runtime.readManagedImagePreviewDataUrl}
                readManagedVideoPreviewUrl={runtime.readManagedVideoPreviewUrl}
                readLocalImagePreviewDataUrl={runtime.readLocalImagePreviewDataUrl}
                readLocalVideoPreviewUrl={runtime.readLocalVideoPreviewUrl}
                saveLocalImageAs={runtime.saveLocalImageAs}
                onOpenSubagentViewer={onOpenSubagentViewer}
                onAbortShell={(toolCallId) => {
                  void runtime.abortShellCommand(toolCallId);
                }}
                queuedCanMoveUp={queuedCanMoveUp}
                queueActionBusy={runtime.busyAction === "send"}
                onQueueMoveUp={(queueId) => {
                  void runtime.reorderQueuedUserTurn(queueId);
                }}
                onQueueSendNow={(queueId) => {
                  void runtime.sendQueuedUserTurnNow(queueId);
                }}
                onQueueDelete={(queueId) => {
                  void runtime.removeQueuedUserTurn(queueId);
                }}
                conversationIsBusy={conversationIsBusy}
                activeSessionReadOnly={activeSessionReadOnly}
                forkBusy={runtime.busyAction === "fork"}
                forkMenuAlwaysVisible={
                  !conversationIsBusy && turnActionsToolbarHostIndex === index
                }
                forkMenuHoverRevealed={forkMenuHoverRevealed}
                assistantTurnStartIndex={assistantTurnStart}
                onAssistantTurnPointerEnter={handleAssistantTurnPointerEnter}
                onAssistantTurnPointerLeave={handleAssistantTurnPointerLeave}
                onForkMessage={onForkMessage}
              />
            );
          })}
        </div>
      </ToolCallDiffHostProvider>
    </div>
  );
}
