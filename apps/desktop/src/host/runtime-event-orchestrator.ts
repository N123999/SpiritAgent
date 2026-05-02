import type {
  JsonObject,
  RuntimeEvent,
  RuntimeToolExecution,
} from '@spirit-agent/agent-core';
import type { HostExtensionEvent } from '@spirit-agent/host-internal';

import type { ConversationMessageSnapshot } from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import type { DesktopRuntime } from './runtime.js';
import type { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import type { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import {
  assistantPrefixBeforeFirstToolInCurrentTurn,
  headlineForStreamingToolPreview,
  indexForThinkingInsertBeforeFirstToolAfterLastUser,
  lastAssistantPlainTextInHistory,
  latestUnsyncedAssistantTextInCurrentTurn,
  messageOrderDebugLevel,
  summarizeMessagesTailForOrderDebug,
  toolMessageKey,
} from './message-ordering.js';

export interface DesktopRuntimeEventOrchestratorOptions {
  runtime: () => DesktopRuntime | undefined;
  messages: () => ConversationMessageSnapshot[];
  allocateMessageId: () => number;
  assistantMessages: DesktopAssistantMessageStateMachine;
  conversationSnapshotView: DesktopConversationSnapshotView;
  clearCurrentTurnSkills: () => void;
  setLastRuntimeError: (error: string) => void;
  refreshArchiveFromRuntime: () => void;
  dispatchExtensionEvent: (event: HostExtensionEvent) => void;
  bindFileChangesToToolMessage: (
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ) => void;
}

export class DesktopRuntimeEventOrchestrator {
  private lastApplyEventBatchId = 0;
  private messageOrderDebugLastVerboseLogMs = 0;

  constructor(private readonly options: DesktopRuntimeEventOrchestratorOptions) {}

  reset(): void {
    this.lastApplyEventBatchId = 0;
    this.messageOrderDebugLastVerboseLogMs = 0;
  }

  consumeCompletedTurnResult(): void {
    const runtime = this.options.runtime();
    if (!runtime) {
      return;
    }

    const result = runtime.takeCompletedTurnResult();
    if (!result) {
      return;
    }

    this.integrateToolExecutions(result.toolExecutions);
    switch (result.kind) {
      case 'completed':
        this.options.clearCurrentTurnSkills();
        if (result.assistantText.trim()) {
          const aux = this.options.assistantMessages.takeLatestPendingAux();
          if (!this.options.assistantMessages.materializeExistingCompletedAssistantMessage(result.assistantText, aux)) {
            this.options.assistantMessages.appendAssistantMessage(result.assistantText, aux);
          }
        }
        this.options.setLastRuntimeError('');
        break;
      case 'failed':
        this.options.clearCurrentTurnSkills();
        {
          const aux = this.options.assistantMessages.takeLatestPendingAux();
          if (!this.options.assistantMessages.materializeExistingCompletedAssistantMessage(result.error, aux)) {
            this.options.assistantMessages.appendAssistantMessage(result.error, aux);
          }
        }
        this.options.setLastRuntimeError(result.error);
        break;
      case 'requires-approval':
      case 'requires-questions':
        this.syncPendingToolStates();
        this.syncAssistantPrefixFromHistoryBeforeToolRow();
        this.options.setLastRuntimeError('');
        break;
      default:
        break;
    }

    this.options.refreshArchiveFromRuntime();
  }

  applyRuntimeHostEvents(events: RuntimeEvent<DesktopToolRequest>[]): void {
    const messages = this.options.messages();
    const batchId =
      events.length > 0 ? (this.lastApplyEventBatchId += 1) : this.lastApplyEventBatchId;
    for (const event of events) {
      if (event.kind === 'begin-assistant-response') {
        const insertAt = messages.length;
        const shouldReanchorStandalonePendingAux =
          this.options.conversationSnapshotView.shouldReanchorPersistedStandaloneSubagentStatusOnBeginAssistantResponse(
            messages[messages.length - 1],
          );
        const pendingAssistant = this.options.assistantMessages.beginAssistantResponse(insertAt, batchId);
        if (shouldReanchorStandalonePendingAux) {
          this.options.conversationSnapshotView.reanchorPersistedStandalonePendingAux(pendingAssistant.id);
        }
        continue;
      }
      if (event.kind === 'update-pending-assistant-thinking') {
        this.options.assistantMessages.updatePendingAssistantAux('thinking', event.text);
        continue;
      }
      if (event.kind === 'update-pending-assistant-compaction') {
        this.options.assistantMessages.updatePendingAssistantAux('compressing', event.text);
        continue;
      }
      if (event.kind === 'assistant-chunk') {
        this.options.assistantMessages.appendPendingAssistantChunk(event.text);
        continue;
      }
      if (event.kind === 'replace-pending-assistant') {
        this.options.assistantMessages.replacePendingAssistantText(event.text);
        continue;
      }
      if (event.kind === 'assistant-response-completed') {
        this.options.assistantMessages.completePendingAssistantMessage();
        continue;
      }
      if (event.kind === 'remove-pending-assistant') {
        this.options.assistantMessages.removePendingAssistantMessage();
        continue;
      }
      if (event.kind === 'assistant-thinking-segment-finalized') {
        if (event.text.trim()) {
          this.options.assistantMessages.appendAssistantThinkingSegment(event.text);
        }
        continue;
      }
      if (event.kind === 'tool-call-started') {
        this.options.dispatchExtensionEvent({
          type: 'onToolCall',
          detail: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            request: event.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind === 'approval-resolved') {
        this.options.dispatchExtensionEvent({
          type: 'onApprovalResolved',
          detail: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            decisionKind: event.decisionKind,
            request: event.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind === 'tool-execution-finished') {
        this.integrateToolExecutions([event.execution]);
        this.options.dispatchExtensionEvent({
          type: 'onToolResult',
          detail: {
            toolCallId: event.execution.toolCallId,
            toolName: event.execution.toolName,
            output: event.execution.output,
            failed: event.execution.failed,
            request: event.execution.request as JsonObject,
          },
        });
        continue;
      }
      if (event.kind !== 'streaming-tool-preview') {
        continue;
      }
      let argsExcerpt: string;
      try {
        argsExcerpt = truncateJson(JSON.parse(event.argumentsJson) as unknown);
      } catch {
        argsExcerpt = truncateText(event.argumentsJson, 4_000);
      }
      this.options.assistantMessages.upsertToolMessage(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        phase: 'running',
        headline: headlineForStreamingToolPreview(messages, event.toolCallId, event.toolName),
        detailLines: [],
        argsExcerpt,
      }, batchId);
    }
    const placement = this.options.assistantMessages.placementState();
    this.logMessageOrderApplyBatch(
      batchId,
      events,
      messages,
      placement.streamAssistantThinkingAnchor,
      placement.streamAssistantAnchorSetInApplyBatchId,
    );
  }

  syncAssistantPrefixFromHistoryBeforeToolRow(): void {
    const runtime = this.options.runtime();
    if (!runtime) {
      return;
    }
    const pendingTrim = runtime.pendingAssistantText().trim();
    const awaitingInteractive =
      Boolean(runtime.currentPendingApproval()) ||
      Boolean(runtime.currentPendingQuestions());

    if (pendingTrim && !awaitingInteractive) {
      return;
    }

    const history = runtime.history();
    const messages = this.options.messages();
    const prefixFromUnsyncedLatest = latestUnsyncedAssistantTextInCurrentTurn(
      history,
      messages,
    );
    const prefixFromBeforeFirst = assistantPrefixBeforeFirstToolInCurrentTurn(history);
    const prefixFromLastAssistant = lastAssistantPlainTextInHistory(history);
    const prefix = (
      awaitingInteractive && pendingTrim
        ? pendingTrim
        : awaitingInteractive
          ? (prefixFromUnsyncedLatest ?? prefixFromLastAssistant ?? prefixFromBeforeFirst)
          : (prefixFromUnsyncedLatest ?? prefixFromBeforeFirst)
    )
      ?.trim() ?? '';
    const messageCount = messages.length;
    const lastMessage = messageCount > 0 ? messages[messageCount - 1] : undefined;

    if (!prefix || messageCount === 0) {
      return;
    }

    const hasPlainPrefix = messages.some(
      (message) => message.role === 'assistant' && message.content === prefix && !message.tool,
    );
    if (hasPlainPrefix) {
      return;
    }

    const isLaterUnsyncedPrefix =
      !awaitingInteractive &&
      prefixFromUnsyncedLatest !== undefined &&
      prefix === prefixFromUnsyncedLatest &&
      prefixFromUnsyncedLatest !== prefixFromBeforeFirst;

    if (isLaterUnsyncedPrefix) {
      const anchor = this.options.assistantMessages.streamAssistantThinkingAnchorOr(messages.length);
      const insertAt = Math.max(0, Math.min(anchor, messages.length));
      const before = insertAt > 0 ? messages[insertAt - 1] : undefined;
      if (
        before?.role === 'assistant' &&
        !before.tool &&
        before.content.trim() === prefix
      ) {
        return;
      }
      this.insertAssistantPrefix(insertAt, prefix, `splice-at-anchor@${insertAt}`);
      return;
    }

    if (awaitingInteractive) {
      const approval = runtime.currentPendingApproval();
      const questions = runtime.currentPendingQuestions();
      const key = approval
        ? toolMessageKey(approval)
        : questions
          ? toolMessageKey(questions)
          : undefined;
      if (key) {
        const index = messages.findIndex(
          (message) => message.role === 'assistant' && message.tool?.toolCallId === key,
        );
        if (index >= 0) {
          const before = index > 0 ? messages[index - 1] : undefined;
          if (
            before?.role === 'assistant' &&
            !before.tool &&
            before.content.trim() === prefix
          ) {
            return;
          }
          this.insertAssistantPrefix(index, prefix, `splice-before-approval@${index}`);
        }
      }
      return;
    }

    if (lastMessage!.role === 'user') {
      messages.push({
        id: this.options.allocateMessageId(),
        role: 'assistant',
        content: prefix,
        pending: false,
      });
      this.logMessageOrderPrefixSync('push-after-user', messages);
      return;
    }

    if (lastMessage!.role === 'assistant' && lastMessage!.tool) {
      const firstToolIndex = indexForThinkingInsertBeforeFirstToolAfterLastUser(messages);
      if (firstToolIndex === undefined) {
        return;
      }
      const beforeFirst = firstToolIndex > 0 ? messages[firstToolIndex - 1] : undefined;
      if (beforeFirst?.role === 'assistant' && beforeFirst.content === prefix && !beforeFirst.tool) {
        return;
      }
      this.insertAssistantPrefix(firstToolIndex, prefix, `splice-before-first-tool@${firstToolIndex}`);
      return;
    }

    if (lastMessage!.role === 'assistant' && !lastMessage!.tool && lastMessage!.content.trim() && lastMessage!.content !== prefix) {
      const firstToolIndex = indexForThinkingInsertBeforeFirstToolAfterLastUser(messages);
      if (firstToolIndex !== undefined) {
        const beforeFirst = firstToolIndex > 0 ? messages[firstToolIndex - 1] : undefined;
        if (beforeFirst?.role === 'assistant' && beforeFirst.content === prefix && !beforeFirst.tool) {
          return;
        }
        this.insertAssistantPrefix(firstToolIndex, prefix, `splice-before-first-tool@${firstToolIndex}`);
        return;
      }
      let toolIndex = -1;
      for (let index = messageCount - 2; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role === 'assistant' && message.tool) {
          toolIndex = index;
          break;
        }
      }
      if (toolIndex >= 0) {
        const beforeTool = toolIndex > 0 ? messages[toolIndex - 1] : undefined;
        if (beforeTool?.role === 'assistant' && beforeTool.content === prefix && !beforeTool.tool) {
          return;
        }
        this.insertAssistantPrefix(toolIndex, prefix, `splice-before-tool@${toolIndex}`);
        return;
      }
      if (!lastMessage!.content.startsWith(prefix)) {
        this.insertAssistantPrefix(messageCount - 1, prefix, `splice-before-tail@${messageCount - 1}`);
      }
      return;
    }
  }

  syncPendingToolStates(): void {
    const runtime = this.options.runtime();
    const approval = runtime?.currentPendingApproval();
    if (approval) {
      this.options.assistantMessages.upsertToolMessage(toolMessageKey(approval), {
        toolCallId: toolMessageKey(approval),
        toolName: approval.toolName,
        phase: 'pending-approval',
        headline: `等待确认: ${approval.toolName}`,
        detailLines: [approval.prompt],
        argsExcerpt: truncateJson(approval.request),
      }, this.lastApplyEventBatchId);
    }

    const questions = runtime?.currentPendingQuestions();
    if (questions) {
      this.options.assistantMessages.upsertToolMessage(toolMessageKey(questions), {
        toolCallId: toolMessageKey(questions),
        toolName: questions.toolName,
        phase: 'pending-approval',
        headline: `等待补充信息: ${questions.toolName}`,
        detailLines: [questions.questions.title ?? '请回答表单问题'],
        argsExcerpt: truncateJson(questions.questions),
      }, this.lastApplyEventBatchId);
    }
  }

  private integrateToolExecutions(executions: RuntimeToolExecution<DesktopToolRequest>[]): void {
    for (const execution of executions) {
      const message = this.options.assistantMessages.upsertToolMessage(execution.toolCallId || `tool:${execution.toolName}`, {
        toolCallId: execution.toolCallId || `tool:${execution.toolName}`,
        toolName: execution.toolName,
        phase: execution.failed ? 'failed' : 'succeeded',
        headline: execution.failed
          ? `工具执行失败: ${execution.toolName}`
          : `工具执行完成: ${execution.toolName}`,
        detailLines: [],
        argsExcerpt: truncateJson(execution.request),
        outputExcerpt: truncateText(execution.output, 4_000),
      }, this.lastApplyEventBatchId);
      this.options.bindFileChangesToToolMessage(execution, message.id);
    }
  }

  private insertAssistantPrefix(insertAt: number, prefix: string, logLabel: string): void {
    const messages = this.options.messages();
    this.options.assistantMessages.shiftStreamAssistantThinkingAnchorForInsertion(insertAt);
    messages.splice(insertAt, 0, {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content: prefix,
      pending: false,
    });
    this.logMessageOrderPrefixSync(logLabel, messages);
  }

  private logMessageOrderApplyBatch(
    batchId: number,
    events: RuntimeEvent<DesktopToolRequest>[],
    messages: ConversationMessageSnapshot[],
    anchorEnd: number | undefined,
    anchorSourceBatchEnd: number,
  ): void {
    const mode = messageOrderDebugLevel();
    if (mode === 'off') return;

    const tags: string[] = [];
    let previewCount = 0;
    for (const event of events) {
      if (event.kind === 'begin-assistant-response') {
        tags.push('begin');
      } else if (event.kind === 'assistant-response-completed') {
        tags.push('resp-done');
      } else if (event.kind === 'remove-pending-assistant') {
        tags.push('rm-pending');
      } else if (event.kind === 'assistant-thinking-segment-finalized') {
        tags.push(event.text.trim() ? 'finalize' : 'finalize-empty');
      } else if (event.kind === 'tool-call-started') {
        tags.push(`tool-start:${event.toolName}`);
      } else if (event.kind === 'tool-execution-finished') {
        tags.push(`tool-done:${event.execution.toolName}`);
      } else if (event.kind === 'approval-resolved') {
        tags.push(`approval-${event.decisionKind}`);
      } else if (event.kind === 'approval-requested') {
        tags.push(`approval:${event.approval.toolName}`);
      } else if (event.kind === 'questions-requested') {
        tags.push(`questions:${event.questions.toolName}`);
      } else if (event.kind === 'streaming-tool-preview') {
        previewCount += 1;
      }
    }

    const hasOrderTags = tags.length > 0;
    if (!hasOrderTags && previewCount === 0) {
      return;
    }

    if (mode === 'compact' && !hasOrderTags) {
      return;
    }

    if (!hasOrderTags && previewCount > 0 && mode === 'verbose') {
      const now = Date.now();
      if (now - this.messageOrderDebugLastVerboseLogMs < 1200) {
        return;
      }
      this.messageOrderDebugLastVerboseLogMs = now;
      tags.push(`preview×${previewCount}`);
    } else if (hasOrderTags && previewCount > 0 && mode === 'verbose') {
      tags.push(`pv×${previewCount}`);
    }

    const tail = summarizeMessagesTailForOrderDebug(messages, 12);
    console.log(
      `[desktop-host][msg-order] apply#${batchId} kinds=${tags.join(',')} anchor=${anchorEnd ?? '∅'} anchorBatch=${anchorSourceBatchEnd} len=${messages.length} tail=${tail}`,
    );
  }

  private logMessageOrderPrefixSync(how: string, messages: ConversationMessageSnapshot[]): void {
    if (messageOrderDebugLevel() === 'off') {
      return;
    }
    const tail = summarizeMessagesTailForOrderDebug(messages, 10);
    console.log(`[desktop-host][msg-order] prefix-sync ${how} len=${messages.length} tail=${tail}`);
  }
}

function truncateJson(value: unknown): string {
  return truncateText(JSON.stringify(value, null, 2), 4_000);
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}
