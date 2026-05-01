import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  ToolBlockSnapshot,
} from '../types.js';
import {
  describeAuxForDebug,
  describeOptionalAuxForDebug,
  hasStandaloneThinkingMessageInCurrentTurn,
  indexForThinkingInsertAfterLastUser,
  indexForThinkingInsertBeforeFirstToolAfterLastUser,
  messageIndexIsInCurrentTurn,
  messageOrderDebugLevel,
  normalizeMessageAuxSnapshot,
  stripPendingThinkingMatchingFinalized,
  stripThinkingFromAux,
  summarizeMessagesTailForOrderDebug,
  truncateOneLineForDebug,
} from './message-ordering.js';
import {
  pruneEmptyAssistantMessages as pruneEmptyAssistantMessagesFromSnapshots,
  shiftStreamAssistantThinkingAnchorForInsertion as shiftThinkingAnchorForInsertion,
  shiftStreamAssistantThinkingAnchorForRemoval as shiftThinkingAnchorForRemoval,
} from './message-snapshots.js';

export interface DesktopAssistantMessageStateMachineOptions {
  messages: () => ConversationMessageSnapshot[];
  setMessages: (messages: ConversationMessageSnapshot[]) => void;
  allocateMessageId: () => number;
  isRuntimeBusy: () => boolean;
}

export interface AssistantStandaloneAnchorState {
  pendingAssistantMessageId?: number;
  lastSettledAssistantMessageId?: number;
}

export interface AssistantPlacementState {
  streamAssistantThinkingAnchor?: number;
  streamAssistantAnchorSetInApplyBatchId: number;
}

export class DesktopAssistantMessageStateMachine {
  private latestPendingAssistantAux: MessageAuxSnapshot | undefined;
  private pendingAssistantMessageId: number | undefined;
  private lastSettledAssistantMessageId: number | undefined;
  private lastFinalizedThinkingSegment = '';
  private streamAssistantThinkingAnchor: number | undefined;
  private streamAssistantAnchorSetInApplyBatchId = 0;

  constructor(private readonly options: DesktopAssistantMessageStateMachineOptions) {}

  standaloneAnchorState(): AssistantStandaloneAnchorState {
    return {
      pendingAssistantMessageId: this.pendingAssistantMessageId,
      lastSettledAssistantMessageId: this.lastSettledAssistantMessageId,
    };
  }

  placementState(): AssistantPlacementState {
    return {
      streamAssistantThinkingAnchor: this.streamAssistantThinkingAnchor,
      streamAssistantAnchorSetInApplyBatchId: this.streamAssistantAnchorSetInApplyBatchId,
    };
  }

  beginAssistantResponse(insertAt: number, batchId: number): ConversationMessageSnapshot {
    this.pendingAssistantMessageId = undefined;
    this.latestPendingAssistantAux = undefined;
    this.streamAssistantThinkingAnchor =
      this.streamAssistantThinkingAnchor === undefined
        ? insertAt
        : Math.min(this.streamAssistantThinkingAnchor, insertAt);
    this.streamAssistantAnchorSetInApplyBatchId = batchId;
    return this.ensurePendingAssistantMessage();
  }

  upsertToolMessage(
    toolCallId: string,
    tool: ToolBlockSnapshot,
    batchId: number,
  ): ConversationMessageSnapshot {
    const messages = this.messages();
    const existing = messages.find(
      (message) => message.tool?.toolCallId === toolCallId,
    );

    if (existing) {
      const previousTool = existing.tool;
      existing.tool = tool;
      this.logToolMessageUpdate(existing.id, toolCallId, previousTool, tool, messages);
      return existing;
    }

    if (this.streamAssistantThinkingAnchor === undefined) {
      this.streamAssistantThinkingAnchor = messages.length;
    }
    this.streamAssistantAnchorSetInApplyBatchId = batchId;
    const pushAt = messages.length;
    const message: ConversationMessageSnapshot = {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content: '',
      tool,
      pending: false,
    };
    messages.push(message);
    this.logMessageOrderToolPreviewNew(tool.toolName, pushAt);
    return message;
  }

  appendAssistantMessage(content: string, aux?: MessageAuxSnapshot): void {
    const messages = this.messages();
    const finalAux = this.normalizeCompletedAssistantAux(aux);
    const message: ConversationMessageSnapshot = {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content,
      ...(finalAux ? { aux: finalAux } : {}),
      pending: false,
    };
    messages.push(message);
    this.logAssistantAuxDecision('append-assistant', {
      messageId: message.id,
      aux: message.aux,
      content,
    });
  }

  appendAssistantThinkingSegment(text: string): void {
    this.lastFinalizedThinkingSegment = text.trim();
    const messages = this.messages();
    this.stripFinalizedThinkingFromAssistantAnchors(text);
    const message: ConversationMessageSnapshot = {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content: '',
      aux: { thinking: text },
      pending: false,
    };
    let insertAt = this.streamAssistantThinkingAnchor;
    this.streamAssistantThinkingAnchor = undefined;
    if (insertAt === undefined) {
      insertAt = indexForThinkingInsertBeforeFirstToolAfterLastUser(messages);
    }
    if (insertAt === undefined) {
      insertAt = indexForThinkingInsertAfterLastUser(messages);
    }
    const clamped = Math.max(0, Math.min(insertAt, messages.length));
    messages.splice(clamped, 0, message);
    const placed = `splice@${clamped}`;
    this.logMessageOrderThinkingFinalized(placed, messages.length, text);
    this.latestPendingAssistantAux = stripPendingThinkingMatchingFinalized(
      this.latestPendingAssistantAux,
      text,
    );
  }

  updatePendingAssistantAux(
    kind: 'thinking' | 'compressing',
    text: string,
  ): void {
    const normalized = text.trim();
    const existingIndex = this.findPendingAssistantMessageIndex();
    const message =
      existingIndex !== undefined
        ? this.messages()[existingIndex]!
        : normalized && this.options.isRuntimeBusy()
          ? this.ensurePendingAssistantMessage()
          : undefined;
    const currentAux = message?.aux ?? this.latestPendingAssistantAux;
    const nextAux = normalizeMessageAuxSnapshot({
      ...(kind === 'thinking'
        ? normalized
          ? { thinking: text }
          : {}
        : currentAux?.thinking
          ? { thinking: currentAux.thinking }
          : {}),
      ...(kind === 'compressing'
        ? normalized
          ? { compaction: text }
          : {}
        : currentAux?.compaction
          ? { compaction: currentAux.compaction }
          : {}),
    });

    if (message) {
      if (nextAux) {
        message.aux = nextAux;
      } else {
        delete message.aux;
      }
    }

    if (nextAux) {
      this.latestPendingAssistantAux = nextAux;
    } else {
      this.latestPendingAssistantAux = undefined;
    }
  }

  appendPendingAssistantChunk(chunk: string): void {
    const message = this.ensurePendingAssistantMessage();
    message.content += chunk;
  }

  replacePendingAssistantText(text: string): void {
    const message = this.ensurePendingAssistantMessage();
    message.content = text;
  }

  completePendingAssistantMessage(): void {
    const index = this.findPendingAssistantMessageIndex();
    if (index === undefined) {
      this.pendingAssistantMessageId = undefined;
      return;
    }
    const message = this.messages()[index]!;
    message.pending = false;
    this.lastSettledAssistantMessageId = message.id;
    this.pendingAssistantMessageId = undefined;
    this.latestPendingAssistantAux = undefined;
  }

  removePendingAssistantMessage(): void {
    const index = this.findPendingAssistantMessageIndex();
    if (index === undefined) {
      this.pendingAssistantMessageId = undefined;
      this.latestPendingAssistantAux = undefined;
      return;
    }

    const messages = this.messages();
    const message = messages[index]!;
    const aux = normalizeMessageAuxSnapshot(message.aux);
    if (!message.content.trim() && !aux) {
      this.handleMessageRemoved(index, message.id, 'remove-pending-assistant');
      messages.splice(index, 1);
    } else {
      message.pending = false;
      if (aux) {
        message.aux = aux;
      } else {
        delete message.aux;
      }
      this.lastSettledAssistantMessageId = message.id;
    }
    this.pendingAssistantMessageId = undefined;
    this.latestPendingAssistantAux = undefined;
  }

  materializeExistingCompletedAssistantMessage(
    content: string,
    aux?: MessageAuxSnapshot,
  ): boolean {
    const messages = this.messages();
    const normalized = content.trim();
    const finalAux = this.normalizeCompletedAssistantAux(aux);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.role !== 'assistant' || message.tool) {
        continue;
      }
      if (message.pending) {
        continue;
      }
      if (message.content.trim() !== normalized) {
        continue;
      }
      if (finalAux) {
        message.aux = normalizeMessageAuxSnapshot({
          ...(message.aux?.thinking ? { thinking: message.aux.thinking } : {}),
          ...(message.aux?.compaction ? { compaction: message.aux.compaction } : {}),
          ...(finalAux.thinking ? { thinking: finalAux.thinking } : {}),
          ...(finalAux.compaction ? { compaction: finalAux.compaction } : {}),
        });
      }
      if (hasStandaloneThinkingMessageInCurrentTurn(messages)) {
        message.aux = stripThinkingFromAux(message.aux);
        if (!message.aux) {
          delete message.aux;
        }
      }
      this.logAssistantAuxDecision('materialize-completed', {
        messageId: message.id,
        aux: message.aux,
        content,
      });
      return true;
    }
    return false;
  }

  takeLatestPendingAux(): MessageAuxSnapshot | undefined {
    const current = this.latestPendingAssistantAux;
    this.latestPendingAssistantAux = undefined;
    if (!current) {
      this.logAssistantAuxDecision('take-pending-aux-none', {
        finalizedThinking: this.lastFinalizedThinkingSegment,
      });
      this.lastFinalizedThinkingSegment = '';
      return undefined;
    }
    if (
      this.lastFinalizedThinkingSegment &&
      current.thinking?.trim() === this.lastFinalizedThinkingSegment.trim()
    ) {
      const { thinking: _thinking, ...rest } = current;
      this.logAssistantAuxDecision('take-pending-aux-strip-exact', {
        aux: current,
        finalizedThinking: this.lastFinalizedThinkingSegment,
        extra: Object.keys(rest).length > 0 ? `kept=${describeAuxForDebug(rest)}` : 'kept=none',
      });
      this.lastFinalizedThinkingSegment = '';
      return Object.keys(rest).length > 0 ? rest : undefined;
    }
    if (current.thinking && hasStandaloneThinkingMessageInCurrentTurn(this.messages())) {
      const stripped = stripThinkingFromAux(current);
      this.logAssistantAuxDecision('take-pending-aux-strip-standalone', {
        aux: current,
        finalizedThinking: this.lastFinalizedThinkingSegment,
        extra: stripped ? `kept=${describeAuxForDebug(stripped)}` : 'kept=none',
      });
      this.lastFinalizedThinkingSegment = '';
      return stripped;
    }
    this.logAssistantAuxDecision('take-pending-aux-carry', {
      aux: current,
      finalizedThinking: this.lastFinalizedThinkingSegment,
    });
    this.lastFinalizedThinkingSegment = '';
    return current;
  }

  pruneEmptyAssistantMessages(reason: string): void {
    const { messages, removed } = pruneEmptyAssistantMessagesFromSnapshots(this.messages());
    this.options.setMessages(messages);
    for (const removal of removed) {
      this.handleMessageRemoved(removal.messageIndex, removal.messageId, `prune:${reason}`);
    }
    if (removed.length > 0) {
      const removedIds = removed.map((removal) => removal.messageId);
      console.warn(
        `[desktop-host][messages] dropped ${removedIds.length} empty assistant message(s) during ${reason}: ${removedIds.join(', ')}`,
      );
    }
  }

  streamAssistantThinkingAnchorOr(defaultValue: number): number {
    return this.streamAssistantThinkingAnchor ?? defaultValue;
  }

  shiftStreamAssistantThinkingAnchorForInsertion(insertAt: number): void {
    this.streamAssistantThinkingAnchor = shiftThinkingAnchorForInsertion(
      this.streamAssistantThinkingAnchor,
      insertAt,
    );
  }

  shiftStreamAssistantThinkingAnchorForRemoval(removeAt: number, removeCount = 1): void {
    this.streamAssistantThinkingAnchor = shiftThinkingAnchorForRemoval(
      this.streamAssistantThinkingAnchor,
      removeAt,
      removeCount,
    );
  }

  handleMessageRemoved(messageIndex: number, messageId: number, reason: string): void {
    this.shiftStreamAssistantThinkingAnchorForRemoval(messageIndex);
    if (this.pendingAssistantMessageId === messageId) {
      this.pendingAssistantMessageId = undefined;
    }
    if (this.lastSettledAssistantMessageId === messageId) {
      this.lastSettledAssistantMessageId = undefined;
    }
    this.logAssistantAuxDecision('remove-message-anchor-shift', {
      messageId,
      extra: `reason=${reason} nextAnchor=${this.streamAssistantThinkingAnchor ?? '∅'}`,
    });
  }

  resetStreamingPlacementState(full: boolean): void {
    this.pendingAssistantMessageId = undefined;
    this.lastSettledAssistantMessageId = undefined;
    if (!full) {
      this.streamAssistantThinkingAnchor = undefined;
      return;
    }
    this.latestPendingAssistantAux = undefined;
    this.lastFinalizedThinkingSegment = '';
    this.streamAssistantThinkingAnchor = undefined;
    this.streamAssistantAnchorSetInApplyBatchId = 0;
  }

  private messages(): ConversationMessageSnapshot[] {
    return this.options.messages();
  }

  private ensurePendingAssistantMessage(): ConversationMessageSnapshot {
    const messages = this.messages();
    const existingIndex = this.findPendingAssistantMessageIndex();
    if (existingIndex !== undefined) {
      return messages[existingIndex]!;
    }

    const message: ConversationMessageSnapshot = {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content: '',
      ...(this.latestPendingAssistantAux ? { aux: { ...this.latestPendingAssistantAux } } : {}),
      pending: true,
    };
    messages.push(message);
    this.pendingAssistantMessageId = message.id;
    return message;
  }

  private findPendingAssistantMessageIndex(): number | undefined {
    const messages = this.messages();
    if (this.pendingAssistantMessageId !== undefined) {
      const index = messages.findIndex(
        (message) =>
          message.id === this.pendingAssistantMessageId &&
          message.role === 'assistant' &&
          message.pending &&
          !message.tool,
      );
      if (index >= 0) {
        return index;
      }
      this.pendingAssistantMessageId = undefined;
    }

    const fallbackIndex = messages.findIndex(
      (message) => message.role === 'assistant' && message.pending && !message.tool,
    );
    if (fallbackIndex >= 0) {
      this.pendingAssistantMessageId = messages[fallbackIndex]!.id;
      return fallbackIndex;
    }
    return undefined;
  }

  private normalizeCompletedAssistantAux(aux?: MessageAuxSnapshot): MessageAuxSnapshot | undefined {
    const normalized = normalizeMessageAuxSnapshot(aux);
    if (!normalized?.thinking) {
      return normalized;
    }
    const messages = this.messages();
    if (!hasStandaloneThinkingMessageInCurrentTurn(messages)) {
      return normalized;
    }
    const stripped = stripThinkingFromAux(normalized);
    this.logAssistantAuxDecision('strip-completed-thinking-aux', {
      aux: normalized,
      extra: stripped ? `kept=${describeAuxForDebug(stripped)}` : 'kept=none',
    });
    return stripped;
  }

  private findLastSettledAssistantMessageIndex(): number | undefined {
    if (this.lastSettledAssistantMessageId === undefined) {
      return undefined;
    }

    const messages = this.messages();
    const index = messages.findIndex(
      (message) =>
        message.id === this.lastSettledAssistantMessageId &&
        message.role === 'assistant' &&
        !message.tool &&
        !message.pending,
    );
    if (index < 0 || !messageIndexIsInCurrentTurn(messages, index)) {
      this.lastSettledAssistantMessageId = undefined;
      return undefined;
    }
    return index;
  }

  private stripFinalizedThinkingFromAssistantAnchors(text: string): void {
    const messages = this.messages();
    const targets: Array<{ kind: 'pending' | 'settled'; index: number | undefined }> = [
      { kind: 'pending', index: this.findPendingAssistantMessageIndex() },
      { kind: 'settled', index: this.findLastSettledAssistantMessageIndex() },
    ];

    for (const target of targets) {
      if (target.index === undefined) {
        continue;
      }
      const message = messages[target.index];
      if (!message) {
        continue;
      }
      const beforeAux = normalizeMessageAuxSnapshot(message.aux);
      const afterAux = stripPendingThinkingMatchingFinalized(beforeAux, text);
      const changed = describeOptionalAuxForDebug(beforeAux) !== describeOptionalAuxForDebug(afterAux);
      if (!changed) {
        continue;
      }
      if (afterAux) {
        message.aux = afterAux;
      } else {
        delete message.aux;
      }
      this.logAssistantAuxDecision('strip-finalized-thinking-anchor', {
        messageId: message.id,
        aux: beforeAux,
        finalizedThinking: text,
        extra: `target=${target.kind} next=${describeOptionalAuxForDebug(afterAux)}`,
      });
      return;
    }

    this.logAssistantAuxDecision('strip-finalized-thinking-miss', {
      finalizedThinking: text,
    });
  }

  private logToolMessageUpdate(
    messageId: number,
    toolCallId: string,
    previousTool: ToolBlockSnapshot | undefined,
    nextTool: ToolBlockSnapshot,
    messages: ReadonlyArray<ConversationMessageSnapshot>,
  ): void {
    const mode = messageOrderDebugLevel();
    if (mode === 'off') {
      return;
    }

    const previousPhase = previousTool?.phase;
    const nextPhase = nextTool.phase;
    const previousHeadline = previousTool?.headline ?? '';
    const nextHeadline = nextTool.headline;
    const previousOutput = previousTool?.outputExcerpt ?? '';
    const nextOutput = nextTool.outputExcerpt ?? '';
    if (
      previousPhase === nextPhase &&
      previousHeadline === nextHeadline &&
      previousOutput === nextOutput
    ) {
      return;
    }

    const tail = summarizeMessagesTailForOrderDebug([...messages], 8);
    console.log(
      `[desktop-host][tool] msg=${messageId} call=${toolCallId} name=${nextTool.toolName} phase=${previousPhase ?? '∅'}->${nextPhase} headline≈${truncateOneLineForDebug(nextHeadline, 42)} tail=${tail}`,
    );
  }

  private logAssistantAuxDecision(
    stage: string,
    details: {
      messageId?: number;
      aux?: MessageAuxSnapshot;
      content?: string;
      finalizedThinking?: string;
      extra?: string;
    },
  ): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const parts = [stage];
    if (details.messageId !== undefined) {
      parts.push(`msg=${details.messageId}`);
    }
    if (details.aux) {
      parts.push(`aux=${describeAuxForDebug(details.aux)}`);
    }
    if (details.finalizedThinking?.trim()) {
      parts.push(`final≈${truncateOneLineForDebug(details.finalizedThinking, 42)}`);
    }
    if (details.content?.trim()) {
      parts.push(`content≈${truncateOneLineForDebug(details.content, 42)}`);
    }
    if (details.extra) {
      parts.push(details.extra);
    }
    console.log(`[desktop-host][aux] ${parts.join(' ')}`);
  }

  private logMessageOrderThinkingFinalized(placed: string, lenAfter: number, text: string): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const oneLine = text.replace(/\s+/g, ' ').trim();
    const clip = oneLine.slice(0, 72);
    console.log(
      `[desktop-host][msg-order] thinking-finalized ${placed} len=${lenAfter} text≈${clip}${oneLine.length > 72 ? '…' : ''}`,
    );
  }

  private logMessageOrderToolPreviewNew(toolName: string, pushAt: number): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    console.log(`[desktop-host][msg-order] tool-preview-new ${toolName} push@${pushAt}`);
  }
}
