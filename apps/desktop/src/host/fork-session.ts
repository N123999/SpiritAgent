import type { ChatArchive } from '@spirit-agent/core';

import type { ConversationMessageSnapshot } from '../types.js';
import {
  buildArchiveAssistantAuxFromConversation,
  buildArchiveMessagesFromConversation,
} from './sessions.js';
import { cloneArchiveHistory, cloneArchiveSubagentSessions } from './service-utils.js';
import {
  truncateMessagesThroughIndex,
} from '../lib/fork-session-utils.js';

export {
  deriveForkedSessionDisplayName,
  findLastForkableAssistantMessageId,
  resolveForkAnchorIndex,
  sanitizeTruncatedMessagesForFork,
  truncateMessagesThroughIndex,
} from '../lib/fork-session-utils.js';

export function buildTruncatedChatArchiveForFork(
  sourceArchive: ChatArchive,
  sourceDesktopMessages: readonly ConversationMessageSnapshot[],
  anchorIndex: number,
): ChatArchive {
  const truncatedDesktop = truncateMessagesThroughIndex(sourceDesktopMessages, anchorIndex);
  const messages = buildArchiveMessagesFromConversation(truncatedDesktop);
  const assistantAux = buildArchiveAssistantAuxFromConversation(truncatedDesktop);
  const llmHistory = truncateLlmHistoryForFork(
    sourceArchive.llmHistory,
    truncatedDesktop,
  );
  return {
    messages,
    assistantAux,
    llmHistory,
    subagentSessions: cloneArchiveSubagentSessions(sourceArchive.subagentSessions ?? []),
    loopEnabled: sourceArchive.loopEnabled,
  };
}

function truncateLlmHistoryForFork(
  fullHistory: ChatArchive['llmHistory'],
  truncatedDesktop: readonly ConversationMessageSnapshot[],
): ChatArchive['llmHistory'] {
  if (fullHistory.length === 0) {
    return [];
  }
  const userTurnCount = truncatedDesktop.filter(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  ).length;
  if (userTurnCount <= 0) {
    return cloneArchiveHistory(fullHistory.slice(0, 1));
  }

  let usersSeen = 0;
  let cutExclusive = fullHistory.length;
  for (let index = 0; index < fullHistory.length; index += 1) {
    const entry = fullHistory[index]!;
    if (entry.role === 'user') {
      usersSeen += 1;
      if (usersSeen > userTurnCount) {
        cutExclusive = index;
        break;
      }
    }
  }
  return cloneArchiveHistory(fullHistory.slice(0, cutExclusive));
}
