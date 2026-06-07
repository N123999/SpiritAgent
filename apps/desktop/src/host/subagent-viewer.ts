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

  const messages = toConversationMessages(
    buildSubagentConversationSnapshots(session.llmHistory, {
      sessionStatus: session.summary.status,
      enrichToolBlock: ({ toolName, phase, request, tool }) =>
        enrichSubagentToolBlock({ toolName, phase, request, tool }),
    }),
  );

  return {
    parentToolCallId: trimmed,
    sessionId: session.summary.sessionId,
    status: session.summary.status,
    promptText: resolveSubagentPromptText(bundle, trimmed),
    messages,
    ...(pendingAuxState ? { pendingAuxState } : {}),
  };
}
