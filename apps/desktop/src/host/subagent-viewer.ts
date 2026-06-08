import type { SubagentSessionArchiveEntry } from '@spirit-agent/core';
import {
  buildSubagentConversationSnapshots,
  resolveSubagentPromptFromTaskFields,
  type SubagentViewerMessage,
} from '@spirit-agent/host-internal';

import type {
  ConversationMessageSnapshot,
  PendingAssistantAux,
  SubagentViewerSnapshot,
  ToolBlockSnapshot,
} from '../types.js';
import {
  applyToolCallSummaryCopy,
  toolCallSummaryForPhase,
} from './message-ordering.js';
import { mapPendingAuxState } from './snapshot-mappers.js';
import type { SessionBundle } from './session-bundle.js';
import {
  ensureSubagentConversationProjection,
  syncSubagentConversationProjections,
} from './subagent-conversation-projection.js';
import { isRunSubagentToolCallPending } from './subagent-stream-sync.js';

function enrichSubagentToolBlock(input: {
  toolName: string;
  phase: ToolBlockSnapshot['phase'];
  request: unknown;
  tool: SubagentViewerMessage['tool'];
}): ToolBlockSnapshot {
  const base = input.tool ?? {
    toolName: input.toolName,
    phase: input.phase,
    headline: input.toolName,
    detailLines: [],
  };
  const summary = toolCallSummaryForPhase(input.phase, input.toolName, input.request);
  return applyToolCallSummaryCopy(base as ToolBlockSnapshot, summary);
}

function toConversationMessages(messages: SubagentViewerMessage[]): ConversationMessageSnapshot[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    pending: message.pending,
    ...(message.tool ? { tool: message.tool as ToolBlockSnapshot } : {}),
    ...(message.aux ? { aux: message.aux } : {}),
  }));
}

export function resolveSubagentSessionByToolCallId(
  bundle: SessionBundle,
  toolCallId: string,
): SubagentSessionArchiveEntry | undefined {
  const trimmed = toolCallId.trim();
  if (!trimmed) {
    return undefined;
  }

  const runtime = bundle.runtime;
  if (runtime) {
    for (const entry of runtime.childSessionArchives()) {
      if (entry.summary.parentToolCallId === trimmed) {
        return entry;
      }
    }
  }

  return bundle.archiveSubagentSessions.find(
    (session) => session.summary.parentToolCallId === trimmed,
  );
}

export function resolveSubagentPromptText(
  bundle: SessionBundle,
  toolCallId: string,
): string {
  const trimmed = toolCallId.trim();
  if (!trimmed) {
    return '';
  }

  const timelineMessages = bundle.messageTimeline.toMessages();
  for (let index = timelineMessages.length - 1; index >= 0; index -= 1) {
    const message = timelineMessages[index];
    if (
      message?.tool?.toolCallId === trimmed
      && message.tool.toolName === 'run_subagent'
    ) {
      const detail = message.tool.headlineDetail?.trim();
      if (detail) {
        return detail;
      }
    }
  }

  const session = resolveSubagentSessionByToolCallId(bundle, trimmed);
  return resolveSubagentPromptFromTaskFields({
    title: session?.summary.title,
  });
}

function countThinkingRows(messages: readonly ConversationMessageSnapshot[]): number {
  return messages.filter((message) => message.aux?.thinking?.trim()).length;
}

function lastAssistantTextContent(messages: readonly ConversationMessageSnapshot[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && typeof message.content === 'string') {
      return message.content;
    }
  }
  return '';
}

function patchCompletedAssistantOutput(
  messages: ConversationMessageSnapshot[],
  finalOutput: string | undefined,
): ConversationMessageSnapshot[] {
  const trimmed = finalOutput?.trim();
  if (!trimmed) {
    return messages;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') {
      continue;
    }

    const current = typeof message.content === 'string' ? message.content : '';
    if (current.length >= trimmed.length) {
      return messages;
    }

    const patched = messages.map((entry) => ({ ...entry }));
    patched[index] = {
      ...message,
      content: trimmed,
      pending: false,
    };
    return patched;
  }

  return messages;
}

function resolveSubagentViewerMessages(input: {
  projected?: ConversationMessageSnapshot[];
  historyMessages: ConversationMessageSnapshot[];
  isLiveSession: boolean;
  finalOutput?: string;
}): { messages: ConversationMessageSnapshot[]; source: string } {
  const projected = input.projected?.map((message) => ({ ...message })) ?? [];
  const history = input.historyMessages;

  if (input.isLiveSession && projected.length > 0) {
    return {
      messages: patchCompletedAssistantOutput(projected, input.finalOutput),
      source: 'projected-live',
    };
  }
  if (projected.length === 0) {
    return {
      messages: patchCompletedAssistantOutput(history, input.finalOutput),
      source: history.length > 0 ? 'history-only' : 'empty',
    };
  }
  if (history.length === 0) {
    return {
      messages: patchCompletedAssistantOutput(projected, input.finalOutput),
      source: 'projected-only',
    };
  }

  if (!input.isLiveSession) {
    const projectedLast = lastAssistantTextContent(projected);
    const historyLast = lastAssistantTextContent(history);
    if (historyLast.length > projectedLast.length) {
      return {
        messages: patchCompletedAssistantOutput(history, input.finalOutput),
        source: 'history-longer-completed',
      };
    }
    if (projectedLast.length > historyLast.length) {
      return {
        messages: patchCompletedAssistantOutput(projected, input.finalOutput),
        source: 'projected-longer-completed',
      };
    }
  }

  const projectedThinking = countThinkingRows(projected);
  const historyThinking = countThinkingRows(history);
  if (projectedThinking > historyThinking) {
    return {
      messages: patchCompletedAssistantOutput(projected, input.finalOutput),
      source: 'projected-richer-thinking',
    };
  }
  if (historyThinking > projectedThinking) {
    return {
      messages: patchCompletedAssistantOutput(history, input.finalOutput),
      source: 'history-richer-thinking',
    };
  }

  if (projected.length >= history.length) {
    return {
      messages: patchCompletedAssistantOutput(projected, input.finalOutput),
      source: 'projected-parity',
    };
  }
  return {
    messages: patchCompletedAssistantOutput(history, input.finalOutput),
    source: 'history-parity',
  };
}

export function isSubagentViewerTargetPending(
  bundle: SessionBundle,
  toolCallId: string,
): boolean {
  const trimmed = toolCallId.trim();
  if (!trimmed) {
    return false;
  }

  if (resolveSubagentSessionByToolCallId(bundle, trimmed)) {
    return true;
  }

  return isRunSubagentToolCallPending(bundle.messageTimeline.toMessages(), trimmed);
}

export function buildSubagentViewerSnapshot(
  bundle: SessionBundle,
  toolCallId: string,
): SubagentViewerSnapshot | undefined {
  const trimmed = toolCallId.trim();
  if (!trimmed) {
    return undefined;
  }

  const session = resolveSubagentSessionByToolCallId(bundle, trimmed);
  if (!session) {
    return undefined;
  }

  const runtime = bundle.runtime;
  const pendingAuxRuntime = runtime?.childSessionPendingAuxState(session.summary.sessionId);
  const pendingAuxState: PendingAssistantAux | undefined = pendingAuxRuntime
    ? mapPendingAuxState(pendingAuxRuntime)
    : undefined;

  syncSubagentConversationProjections(bundle, runtime);

  const historyMessages = toConversationMessages(
    buildSubagentConversationSnapshots(session.llmHistory, {
      sessionStatus: session.summary.status,
      enrichToolBlock: ({ toolName, phase, request, tool }) =>
        enrichSubagentToolBlock({ toolName, phase, request, tool }),
    }),
  );

  const projected = bundle.subagentDesktopMessagesBySessionId.get(session.summary.sessionId);
  const isLiveSession =
    session.summary.status === 'running' || session.summary.status === 'blocked';

  const resolved = resolveSubagentViewerMessages({
    projected,
    historyMessages,
    isLiveSession,
    finalOutput: session.summary.finalOutput,
  });
  const messages = resolved.messages;

  if (
    isLiveSession
    && !projected?.length
  ) {
    ensureSubagentConversationProjection(bundle, session);
  }

  return {
    parentToolCallId: trimmed,
    sessionId: session.summary.sessionId,
    status: session.summary.status,
    promptText: resolveSubagentPromptText(bundle, trimmed),
    messages,
    ...(pendingAuxState ? { pendingAuxState } : {}),
  };
}
