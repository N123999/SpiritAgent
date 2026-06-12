import { useMemo, type ClipboardEvent as ReactClipboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { AgentMarkdownMessage } from "@/components/agent-markdown-message";
import { ComposerSurface } from "@/components/composer/composer-surface";
import type { ComposerLocalFileAttachmentView } from "@/components/composer-local-file-strip";
import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import {
  AssistantCompactionCollapsible,
  AssistantThinkingCollapsible,
} from "@/components/conversation/conversation-thinking-collapsibles";
import { QueuedUserMessageHoverActions } from "@/components/queued-user-message-hover-actions";
import { ToolCallCollapsible } from "@/components/tool-call/tool-call-collapsible";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
  ReadManagedImagePreview,
  ReadManagedVideoPreview,
  SaveLocalImageAs,
} from "@/components/tool-call/tool-call-types";
import { MessageTurnActions } from "@/components/conversation/message-turn-actions";
import { UserMessageBubble } from "@/components/user-message-bubble";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { messageContentToRichSegments } from "@/lib/composer-segment-model";
import {
  shouldShowAssistantCompactionCollapsible,
} from "@/lib/conversation-compaction-ui";
import {
  shouldCollapseThinkingDuringToolPreview,
  shouldShowAssistantThinkingCollapsible,
} from "@/lib/conversation-thinking-ui";
import { conversationMessageStableId } from "@/lib/conversation-list-scope";
import { isSubagentStatusSurfaceMessage } from "@/lib/subagent-display";
import { cn } from "@/lib/utils";
import { canForkMessage, canShowForkMessage } from "@/lib/fork-eligibility";
import { messageShowsAssistantTurnActions } from "@/lib/message-turn-actions-ui";
import type {
  ConversationMessageSnapshot,
  DesktopModelReasoningEffort,
  DesktopSnapshot,
  PendingAssistantAux,
} from "@/types";

export function MessageCard({
  composerSessionKey,
  conversationListScopeKey,
  messages,
  message,
  listIndex,
  compactAfterPrevious,
  tightenAfterPreviousMeta,
  showContinueButton,
  continueTarget,
  continueBusy,
  rewindText,
  rewindLocalFileAttachments,
  rewindBrowserElementAttachments,
  rewindSelected,
  rewindCanSubmit,
  rewindBusy,
  rewindRichInputRef,
  onRewindElementAttachmentsChange,
  canPickLocalFile,
  models,
  catalogHints,
  activeModel,
  agentMode,
  onContinue,
  onRewindChange,
  onRewindStart,
  onRewindSubmit,
  onRewindRemoveLocalFileAttachment,
  onRewindPickLocalFile,
  onRewindPaste,
  onModelSelect,
  onModelReasoningEffortSelect,
  onAgentModeChange,
  pendingAuxState,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  saveLocalImageAs,
  onOpenSubagentViewer,
  onAbortShell,
  queuedCanMoveUp = false,
  queueActionBusy = false,
  onQueueMoveUp,
  onQueueSendNow,
  onQueueDelete,
  conversationIsBusy = false,
  activeSessionReadOnly = false,
  forkBusy = false,
  onForkMessage,
  forkMenuAlwaysVisible = false,
  hiddenByProcessGroup = false,
}: {
  composerSessionKey: string;
  conversationListScopeKey: string;
  messages: readonly ConversationMessageSnapshot[];
  pendingAuxState?: PendingAssistantAux;
  message: ConversationMessageSnapshot;
  listIndex: number;
  hiddenByProcessGroup?: boolean;
  compactAfterPrevious: boolean;
  tightenAfterPreviousMeta: boolean;
  showContinueButton: boolean;
  continueTarget?: ConversationMessageSnapshot;
  continueBusy: boolean;
  rewindText: string;
  rewindLocalFileAttachments: readonly ComposerLocalFileAttachmentView[];
  rewindBrowserElementAttachments: readonly BrowserElementAttachment[];
  rewindSelected: boolean;
  rewindCanSubmit: boolean;
  rewindBusy: boolean;
  rewindRichInputRef: RefObject<ComposerRichInputHandle | null>;
  onRewindElementAttachmentsChange(attachments: BrowserElementAttachment[]): void;
  canPickLocalFile: boolean;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  agentMode: DesktopAgentMode;
  onContinue(message: ConversationMessageSnapshot): void;
  onRewindChange(value: string): void;
  onRewindStart(message: ConversationMessageSnapshot, listIndex: number): void;
  onRewindSubmit(): void;
  onRewindRemoveLocalFileAttachment(path: string): void;
  onRewindPickLocalFile(): void;
  onRewindPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  onAgentModeChange(mode: DesktopAgentMode): void;
  readManagedImagePreviewDataUrl: ReadManagedImagePreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  saveLocalImageAs: SaveLocalImageAs;
  onOpenSubagentViewer?: (toolCallId: string) => void;
  onAbortShell?: (toolCallId: string) => void;
  queuedCanMoveUp?: boolean;
  queueActionBusy?: boolean;
  onQueueMoveUp?(queueId: string): void;
  onQueueSendNow?(queueId: string): void;
  onQueueDelete?(queueId: string): void;
  conversationIsBusy?: boolean;
  activeSessionReadOnly?: boolean;
  forkBusy?: boolean;
  onForkMessage?: (message: ConversationMessageSnapshot, listIndex: number) => void;
  forkMenuAlwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const isQueuedUser = isUser && message.queued === true && typeof message.queueId === "string";
  const canStartRewind =
    isUser && message.canRewind === true && !message.pending && message.queued !== true;
  const userBubble =
    "rounded-2xl rounded-br-md border border-border/50 bg-muted px-3 py-2.5 shadow-sm";
  const subagentStatusSurface =
    !isUser && message.content.trim() ? isSubagentStatusSurfaceMessage(message) : false;
  const showThinkingCollapsible =
    !hiddenByProcessGroup &&
    shouldShowAssistantThinkingCollapsible(message, pendingAuxState, messages, listIndex);
  const showCompactionCollapsible =
    !hiddenByProcessGroup &&
    shouldShowAssistantCompactionCollapsible(message, pendingAuxState);
  const collapseThinkingDuringToolPreview = shouldCollapseThinkingDuringToolPreview(
    messages,
    listIndex,
  );
  const rewindInitialSegments = useMemo(
    () =>
      rewindSelected
        ? messageContentToRichSegments(message.content, String(message.id))
        : null,
    [rewindSelected, message.content, message.id],
  );
  const showTurnActions = !hiddenByProcessGroup && messageShowsAssistantTurnActions(message);
  const showForkMenu =
    showTurnActions
    && canShowForkMessage({
      message,
      activeSessionReadOnly,
    });
  const canFork =
    showForkMenu
    && canForkMessage({
      message,
      conversationBusy: conversationIsBusy,
      activeSessionReadOnly,
      forkBusy,
    });
  return (
    <div
      id={conversationMessageStableId(message, composerSessionKey, conversationListScopeKey)}
      data-spirit-surface="message-row"
      data-spirit-message-role={message.role}
      data-spirit-message-pending={message.pending ? "true" : "false"}
      className={cn(
        "scroll-mt-4 flex w-full pb-3 last:pb-0",
        compactAfterPrevious && "-mt-4",
        tightenAfterPreviousMeta && "-mt-3",
        isUser ? "justify-end" : "justify-start",
        rewindSelected && "relative z-40",
      )}
    >
      <div
        data-spirit-surface={isUser ? "message-user" : "message-assistant"}
        className={cn(
          "min-w-0 space-y-2",
          isUser
            ? rewindSelected
              ? "ml-auto w-full max-w-[min(100%,36rem)]"
              : "max-w-[min(72%,22rem)]"
            : "w-full",
          showTurnActions && "group",
        )}
      >
        {rewindSelected && isUser ? (
          <ComposerSurface
            key={`rewind-composer-${message.id}`}
            richInputRef={rewindRichInputRef}
            value={rewindText}
            initialSegments={rewindInitialSegments}
            browserElementAttachments={rewindBrowserElementAttachments}
            onElementAttachmentsChange={onRewindElementAttachmentsChange}
            localFileAttachments={rewindLocalFileAttachments}
            onChange={onRewindChange}
            onSubmit={onRewindSubmit}
            placeholder={t('app.typeMessage')}
            models={models}
            catalogHints={catalogHints}
            activeModel={activeModel}
            agentMode={agentMode}
            loopEnabled={false}
            onModelSelect={onModelSelect}
            onModelReasoningEffortSelect={onModelReasoningEffortSelect}
            onAgentModeChange={onAgentModeChange}
            onLoopEnabledChange={() => {}}
            canSend={rewindCanSubmit}
            busy={rewindBusy}
            showInsertButton
            canPickLocalFile={canPickLocalFile}
            onPickLocalFile={onRewindPickLocalFile}
            onRemoveLocalFileAttachment={onRewindRemoveLocalFileAttachment}
            onPaste={onRewindPaste}
          />
        ) : null}
        {showThinkingCollapsible ? (
          <AssistantThinkingCollapsible
            message={message}
            pendingAuxState={pendingAuxState}
            messages={messages}
            listIndex={listIndex}
            collapseDuringToolPreview={collapseThinkingDuringToolPreview}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
          />
        ) : null}
        {showCompactionCollapsible ? (
          <AssistantCompactionCollapsible
            message={message}
            pendingAuxState={pendingAuxState}
            readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
          />
        ) : null}
        {isUser && !rewindSelected ? (
          isQueuedUser && message.queueId && onQueueMoveUp && onQueueSendNow && onQueueDelete ? (
            <QueuedUserMessageHoverActions
              queueId={message.queueId}
              canMoveUp={queuedCanMoveUp}
              busy={queueActionBusy}
              onMoveUp={onQueueMoveUp}
              onSendNow={onQueueSendNow}
              onDelete={onQueueDelete}
            >
              <UserMessageBubble
                message={message}
                userBubbleClassName={userBubble}
                canStartRewind={false}
                queued
                onRewindStart={() => onRewindStart(message, listIndex)}
                readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
              />
            </QueuedUserMessageHoverActions>
          ) : (
            <UserMessageBubble
              message={message}
              userBubbleClassName={userBubble}
              canStartRewind={canStartRewind}
              queued={message.queued === true}
              onRewindStart={() => onRewindStart(message, listIndex)}
              readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            />
          )
        ) : null}
        {!isUser && message.content.trim() ? (
          subagentStatusSurface ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{message.content}</p>
          ) : (
          <div data-spirit-surface="message-bubble">
            <AgentMarkdownMessage
              content={message.content}
              streaming={message.pending}
              className="font-sans"
              readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
              readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            />
          </div>
          )
        ) : null}
        {showTurnActions ? (
          <MessageTurnActions
            showContinueButton={showContinueButton}
            continueTarget={continueTarget}
            continueBusy={continueBusy}
            onContinue={onContinue}
            canFork={showForkMenu && Boolean(onForkMessage)}
            forkEnabled={canFork}
            forkMenuAlwaysVisible={forkMenuAlwaysVisible}
            forkBusy={forkBusy}
            onFork={() => onForkMessage?.(message, listIndex)}
          />
        ) : null}
        {!isUser && message.aux?.finishTaskNotice ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {message.aux.finishTaskNotice}
          </p>
        ) : null}
        {!isUser && message.tool ? (
          <ToolCallCollapsible
            tool={message.tool}
            readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
            readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
            saveLocalImageAs={saveLocalImageAs}
            onOpenSubagentViewer={onOpenSubagentViewer}
            onAbortShell={onAbortShell}
          />
        ) : null}
      </div>
    </div>
  );
}
