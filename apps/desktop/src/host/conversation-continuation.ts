import type { ChatArchive, PendingAssistantAux } from '@spirit-agent/core';

import type { ConversationMessageSnapshot } from '../types.js';
import type { SessionBundle } from './session-bundle.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
} from './sessions.js';
import {
  hasInFlightSubagentDelegationInMessages,
  isSubagentStatusSurfaceMessage,
  messageIndexIsInCurrentTurn,
  messageOrderDebugLevel,
  summarizeMessagesTailForOrderDebug,
  summarizeToolRowsForDebug,
  truncateOneLineForDebug,
} from './message-ordering.js';
import {
  extractSubagentSessionStreamingText,
  findRunSubagentToolPhase,
} from './subagent-stream-sync.js';

type ContinuationOrchestration = {
  assistantMessages: {
    upsertToolMessage(toolCallId: string, tool: NonNullable<ConversationMessageSnapshot['tool']>, ordinal: number): void;
    removeToolMessage(toolCallId: string): void;
  };
};

export interface ConversationContinuationContext {
  activeBundle(): SessionBundle;
  activeSessionId(): string | undefined;
  orchestrationFor(bundle: SessionBundle): ContinuationOrchestration;
  lastToolSnapshotLogSignature(): string | undefined;
  setLastToolSnapshotLogSignature(signature: string | undefined): void;
}

export function clearAssistantContinuationMarkers(ctx: ConversationContinuationContext): void {
  const messages = ctx.activeBundle().messages;
  for (const message of messages) {
    delete message.canContinue;
  }
  ctx.activeBundle().messageTimeline.clearContinuationMarkers();
}

export function markAssistantMessageContinuable(ctx: ConversationContinuationContext, content: string): void {
  const normalized = content.trim();
  clearAssistantContinuationMarkers(ctx);

  const messages = ctx.activeBundle().messages;
  const timelineMessage = ctx.activeBundle().messageTimeline.markLatestRenderableAssistantRowContinuable({
    content: normalized,
  });
  if (timelineMessage) {
    const cachedMessage = messages.find((message) => message.id === timelineMessage.id);
    if (cachedMessage) {
      cachedMessage.canContinue = true;
    }
    logContinuationMarker('marked', cachedMessage ?? timelineMessage, normalized, messages);
    return;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const hasRenderableAux = Boolean(
      message.aux?.thinking?.trim() || message.aux?.compaction?.trim(),
    );
    const hasRenderableTool = Boolean(message.tool);
    if (
      message.role !== 'assistant' ||
      message.pending ||
      (!message.content.trim() && !hasRenderableAux && !hasRenderableTool)
    ) {
      continue;
    }
    if (normalized && !message.tool && message.content.trim() !== normalized) {
      continue;
    }
    message.canContinue = true;
    ctx.activeBundle().messageTimeline.markRowContinuable(message.id);
    logContinuationMarker('marked', message, normalized, messages);
    return;
  }

  logContinuationMarker('missing', undefined, normalized, messages);
}

export function latestContinuableAssistantMessage(
  ctx: ConversationContinuationContext,
): ConversationMessageSnapshot | undefined {
  const timelineContinuable = ctx.activeBundle().messageTimeline.latestContinuableAssistantMessage();
  if (timelineContinuable) {
    return timelineContinuable;
  }
  const messages = ctx.activeBundle().messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (
      message.role === 'assistant' &&
      !message.pending &&
      message.canContinue === true
    ) {
      return message;
    }
  }
  return undefined;
}

export function markLatestRenderableAssistantMessageContinuableInCurrentTurn(
  ctx: ConversationContinuationContext,
): void {
  clearAssistantContinuationMarkers(ctx);

  const messages = ctx.activeBundle().messages;
  const timelineMessage = ctx.activeBundle().messageTimeline.markLatestRenderableAssistantRowContinuableInActiveTurn();
  if (timelineMessage) {
    const cachedMessage = messages.find((message) => message.id === timelineMessage.id);
    if (cachedMessage) {
      cachedMessage.canContinue = true;
    }
    logContinuationMarker('marked-fallback', cachedMessage ?? timelineMessage, '', messages);
    return;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!messageIndexIsInCurrentTurn(messages, index)) {
      break;
    }

    const hasRenderableAux = Boolean(
      message.aux?.thinking?.trim() || message.aux?.compaction?.trim(),
    );
    const hasRenderableTool = Boolean(message.tool);
    if (
      message.role !== 'assistant' ||
      message.pending ||
      (!message.content.trim() && !hasRenderableAux && !hasRenderableTool)
    ) {
      continue;
    }

    message.canContinue = true;
    ctx.activeBundle().messageTimeline.markRowContinuable(message.id);
    logContinuationMarker('marked-fallback', message, '', messages);
    return;
  }

  logContinuationMarker('missing-fallback', undefined, '', messages);
}

export function logContinuationSnapshotState(input: {
  rawMessages: ConversationMessageSnapshot[];
  visibleMessages: ConversationMessageSnapshot[];
  isBusy: boolean;
  pendingAux: PendingAssistantAux | undefined;
}): void {
  if (messageOrderDebugLevel() !== 'verbose') {
    return;
  }

  const rawMarked = input.rawMessages.filter((message) => message.canContinue === true);
  const visibleMarked = input.visibleMessages.filter((message) => message.canContinue === true);
  if (rawMarked.length === 0 && visibleMarked.length === 0) {
    return;
  }

  const pendingAux = input.pendingAux
    ? `${input.pendingAux.kind}:${truncateOneLineForDebug(input.pendingAux.detailText ?? input.pendingAux.statusText, 36)}`
    : 'none';
  console.log(
    `[desktop-host][continue] snapshot busy=${input.isBusy} pendingAux=${pendingAux} raw=${rawMarked.map((message) => describeContinuationMessage(message)).join(',') || '∅'} visible=${visibleMarked.map((message) => describeContinuationMessage(message)).join(',') || '∅'} rawTail=${summarizeMessagesTailForOrderDebug(input.rawMessages, 8)} visibleTail=${summarizeMessagesTailForOrderDebug(input.visibleMessages, 8)}`,
  );
}

export function logToolSnapshotState(
  ctx: ConversationContinuationContext,
  input: {
    rawMessages: ConversationMessageSnapshot[];
    timelineMessages: ConversationMessageSnapshot[];
    visibleMessages: ConversationMessageSnapshot[];
    isBusy: boolean;
  },
): void {
  if (messageOrderDebugLevel() !== 'verbose') {
    return;
  }

  const rawTools = summarizeToolRowsForDebug(input.rawMessages, 8);
  const timelineTools = summarizeToolRowsForDebug(input.timelineMessages, 8);
  const visibleTools = summarizeToolRowsForDebug(input.visibleMessages, 8);
  if (rawTools === '∅' && timelineTools === '∅' && visibleTools === '∅') {
    ctx.setLastToolSnapshotLogSignature(undefined);
    return;
  }

  const rawTail = summarizeMessagesTailForOrderDebug(input.rawMessages, 8);
  const timelineTail = summarizeMessagesTailForOrderDebug(input.timelineMessages, 8);
  const visibleTail = summarizeMessagesTailForOrderDebug(input.visibleMessages, 8);
  const signature = [
    input.isBusy ? '1' : '0',
    rawTools,
    timelineTools,
    visibleTools,
    rawTail,
    timelineTail,
    visibleTail,
  ].join('|');
  if (signature === ctx.lastToolSnapshotLogSignature()) {
    return;
  }
  ctx.setLastToolSnapshotLogSignature(signature);

  console.log(
    `[desktop-host][tool-flow] snapshot busy=${input.isBusy} raw=${rawTools} timeline=${timelineTools} visible=${visibleTools} rawTail=${rawTail} timelineTail=${timelineTail} visibleTail=${visibleTail}`,
  );
}

export function syncSubagentToolStreamingOutput(
  ctx: ConversationContinuationContext,
  bundle: SessionBundle,
): void {
  const runtime = bundle.runtime;
  if (!runtime?.isBusy()) {
    return;
  }

  refreshArchiveFromRuntime(ctx, bundle);

  purgeSubagentLeakTextInCurrentTurn(bundle);
  purgeSubagentLeakedToolRowsInCurrentTurn(ctx, bundle);

  const sessions = bundle.archiveSubagentSessions;
  if (sessions.length === 0) {
    return;
  }

  const timelineMessages = bundle.messageTimeline.toMessages();
  const orchestration = ctx.orchestrationFor(bundle);
  for (const session of sessions) {
    if (session.summary.status !== 'running' && session.summary.status !== 'blocked') {
      continue;
    }

    const toolCallId = session.summary.parentToolCallId?.trim();
    if (!toolCallId) {
      continue;
    }

    const existing = timelineMessages.find((message) => message.tool?.toolCallId === toolCallId)?.tool;
    if (!existing) {
      continue;
    }

    const streamingText = extractSubagentSessionStreamingText(session)?.trim();
    const phase = findRunSubagentToolPhase(timelineMessages, toolCallId) ?? 'running';
    const nextPhase = phase === 'preview' || phase === 'running' ? phase : 'running';
    const nextTool = {
      ...existing,
      phase: nextPhase,
      ...(streamingText
        ? {
            outputExcerpt:
              streamingText.length > 4_000 ? streamingText.slice(0, 4_000) : streamingText,
          }
        : {}),
    };

    orchestration.assistantMessages.upsertToolMessage(toolCallId, nextTool, 0);
    bundle.messageTimeline.upsertToolMessage(toolCallId, nextTool);
  }
}

export function syncRuntimeHistoryFromBundleArchive(bundle: SessionBundle): void {
  if (!bundle.runtime) {
    return;
  }

  const desktopMessages = bundle.messageTimeline.toMessages();
  bundle.runtime.replaceFromArchive({
    messages: buildArchiveMessagesFromConversation(desktopMessages),
    assistantAux: buildArchiveAssistantAuxFromConversation(desktopMessages),
    llmHistory: bundle.archiveHistory,
    subagentSessions: bundle.archiveSubagentSessions ?? [],
    loopEnabled: bundle.loopEnabled,
  });
}

export function refreshArchiveFromRuntime(
  ctx: ConversationContinuationContext,
  bundle: SessionBundle = ctx.activeBundle(),
): void {
  if (!bundle.runtime) {
    return;
  }

  const desktopMessages = bundle.messageTimeline.toMessages();
  const archive = bundle.runtime.toArchive(
    buildArchiveMessagesFromConversation(desktopMessages),
    buildArchiveAssistantAuxFromConversation(desktopMessages),
  ) satisfies ChatArchive;
  bundle.archiveHistory = archive.llmHistory;
  bundle.archiveSubagentSessions = archive.subagentSessions ?? [];
}

function logContinuationMarker(
  outcome: 'marked' | 'missing' | 'marked-fallback' | 'missing-fallback',
  message: ConversationMessageSnapshot | undefined,
  normalized: string,
  messages: ConversationMessageSnapshot[],
): void {
  if (messageOrderDebugLevel() !== 'verbose') {
    return;
  }

  const target = message
    ? describeContinuationMessage(message)
    : '∅';
  const text = normalized ? truncateOneLineForDebug(normalized, 48) : '∅';
  const tail = summarizeMessagesTailForOrderDebug(messages, 8);
  console.log(
    `[desktop-host][continue] mark outcome=${outcome} normalized≈${text}${normalized.length > 48 ? '…' : ''} target=${target} tail=${tail}`,
  );
}

function describeContinuationMessage(message: ConversationMessageSnapshot): string {
  const kind = message.tool
    ? `tool:${message.tool.phase}:${message.tool.toolName}`
    : message.aux?.thinking?.trim()
      ? 'thinking'
      : message.aux?.compaction?.trim()
        ? 'compaction'
        : message.content.trim()
          ? 'content'
          : 'empty';
  const text = message.content.trim()
    ? truncateOneLineForDebug(message.content, 28)
    : '∅';
  return `${message.id}:${kind}:${text}`;
}

function purgeSubagentLeakTextInCurrentTurn(bundle: SessionBundle): void {
  const messages = bundle.messageTimeline.toMessages();
  const liveSubagentSession = bundle.archiveSubagentSessions.some(
    (session) => session.summary.status === 'running' || session.summary.status === 'blocked',
  );
  if (!hasInFlightSubagentDelegationInMessages(messages) && !liveSubagentSession) {
    return;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  let runSubagentIndex = -1;
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.tool?.toolName === 'run_subagent') {
      runSubagentIndex = index;
    }
  }

  const startIndex = runSubagentIndex >= 0 ? runSubagentIndex + 1 : lastUserIndex + 1;
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.tool || !message.content.trim()) {
      break;
    }
    if (!isSubagentStatusSurfaceMessage(message)) {
      continue;
    }
    bundle.messageTimeline.clearSubagentStatusLeak(message.id);
  }
}

function purgeSubagentLeakedToolRowsInCurrentTurn(
  ctx: ConversationContinuationContext,
  bundle: SessionBundle,
): void {
  const messages = bundle.messageTimeline.toMessages();
  const liveSubagentSession = bundle.archiveSubagentSessions.some(
    (session) => session.summary.status === 'running' || session.summary.status === 'blocked',
  );
  if (!hasInFlightSubagentDelegationInMessages(messages) && !liveSubagentSession) {
    return;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  let runSubagentIndex = -1;
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.tool?.toolName === 'run_subagent') {
      runSubagentIndex = index;
    }
  }

  const startIndex = runSubagentIndex >= 0 ? runSubagentIndex + 1 : lastUserIndex + 1;
  const orchestration = ctx.orchestrationFor(bundle);
  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || !message.tool || message.tool.toolName === 'run_subagent') {
      continue;
    }
    const toolCallId = message.tool.toolCallId?.trim();
    if (!toolCallId) {
      continue;
    }
    orchestration.assistantMessages.removeToolMessage(toolCallId);
    bundle.messageTimeline.removeToolMessage(toolCallId);
  }
}
