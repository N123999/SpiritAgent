import {
  previewRequestFromStreamingArguments,
  type JsonObject,
  type RuntimeEvent,
  type RuntimeToolExecution,
} from '@spirit-agent/agent-core';
import type { HostExtensionEvent } from '@spirit-agent/host-internal';

import {
  attachEditFileLineDelta,
  type AttachEditFileLineDeltaSource,
  type EditFileLineDelta,
  preserveDeleteFileLineDelta,
} from '../lib/edit-file-line-delta.js';
import i18n from '../lib/i18n-host.js';
import type {
  ConversationMessageSnapshot,
  MessageAuxSnapshot,
  ToolBlockSnapshot,
} from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import type { DesktopRuntime } from './runtime.js';
import type { DesktopAssistantMessageStateMachine } from './assistant-message-state.js';
import type { DesktopConversationSnapshotView } from './conversation-snapshot.js';
import type {
  DesktopMessageTimeline,
  DesktopTimelineSegmentKind,
} from './message-timeline.js';
import {
  assistantPrefixBeforeFirstToolInCurrentTurn,
  finishTaskNoticeFromExecution,
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromExecution,
  applyToolCallSummaryCopy,
  hasActiveRunSubagentToolInMessages,
  isSubagentStatusSurfaceText,
  toolCallSummaryForPhase,
  toolCallSummaryForStreamingPreview,
  isFinishTaskToolName,
  lastAssistantPlainTextInHistory,
  latestUnsyncedAssistantTextInCurrentTurn,
  messageOrderDebugLevel,
  summarizeMessagesTailForOrderDebug,
  summarizeToolRowsForDebug,
  stripReasonLineFromShellPrompt,
  toolMessageKey,
} from './message-ordering.js';

export interface DesktopRuntimeEventOrchestratorOptions {
  runtime: () => DesktopRuntime | undefined;
  messages: () => ConversationMessageSnapshot[];
  allocateMessageId: () => number;
  assistantMessages: DesktopAssistantMessageStateMachine;
  messageTimeline?: () => DesktopMessageTimeline | undefined;
  takeNextAssistantSegmentKind?: () => DesktopTimelineSegmentKind;
  conversationSnapshotView: DesktopConversationSnapshotView;
  clearCurrentTurnSkills: () => void;
  setLastRuntimeError: (error: string) => void;
  refreshArchiveFromRuntime: () => void;
  dispatchExtensionEvent: (event: HostExtensionEvent) => void;
  bindFileChangesToToolMessage: (
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ) => void;
  onTodoStoreMutated?: () => void;
  requestLiveSnapshotUpdate?: () => void;
  /** delete_file：删除前按路径读取磁盘并统计行数 */
  lineDeltaForDeleteFile?: (inputPath: string) => EditFileLineDelta | undefined;
}

function isMcpLikeToolName(toolName: string): boolean {
  return toolName.startsWith('mcp__') || toolName.includes('microsoft_docs');
}

export class DesktopRuntimeEventOrchestrator {
  private lastApplyEventBatchId = 0;
  private messageOrderDebugLastVerboseLogMs = 0;
  private activeGenerateImageTools = new Map<string, ToolBlockSnapshot>();

  constructor(private readonly options: DesktopRuntimeEventOrchestratorOptions) {}

  private findExistingToolLineDelta(toolCallId: string | undefined): EditFileLineDelta | undefined {
    if (!toolCallId) {
      return undefined;
    }
    const messages = this.options.messages();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.tool?.toolCallId === toolCallId && message.tool.editLineDelta) {
        return message.tool.editLineDelta;
      }
    }
    return undefined;
  }

  private attachLineDelta(
    tool: ToolBlockSnapshot,
    source: Omit<AttachEditFileLineDeltaSource, 'resolveDeleteFileLines'>,
  ): ToolBlockSnapshot {
    const attached = attachEditFileLineDelta(tool, {
      ...source,
      resolveDeleteFileLines: this.options.lineDeltaForDeleteFile,
    });
    return preserveDeleteFileLineDelta(
      tool.toolName,
      attached,
      this.findExistingToolLineDelta(tool.toolCallId),
    );
  }

  reset(): void {
    this.lastApplyEventBatchId = 0;
    this.messageOrderDebugLastVerboseLogMs = 0;
    this.activeGenerateImageTools.clear();
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

    this.integrateToolExecutions(result.toolExecutions, 'turn-result');
    switch (result.kind) {
      case 'completed': {
        this.options.clearCurrentTurnSkills();
        const finishExecution = [...result.toolExecutions]
          .reverse()
          .find((execution) => isFinishTaskToolName(execution.toolName) && !execution.failed);
        const failedFinishTask = result.toolExecutions.some(
          (execution) => isFinishTaskToolName(execution.toolName) && execution.failed,
        );
        const aux = this.options.assistantMessages.takeLatestPendingAux();
        if (finishExecution) {
          const summary = finishTaskSummaryFromExecution(finishExecution);
          const notice = finishTaskNoticeFromExecution(finishExecution);
          const noticeAux: MessageAuxSnapshot = {
            ...(aux ?? {}),
            finishTaskNotice: notice,
          };
          this.options.assistantMessages.applyFinishTaskNotice(
            notice,
            result.assistantText,
            aux,
            summary,
          );
          this.options.messageTimeline?.()?.materializeFinishTaskNotice(
            notice,
            summary || result.assistantText,
          );
        } else if (failedFinishTask) {
          this.clearFinishTaskNoticePreview();
        } else if (result.assistantText.trim()) {
          if (!this.options.assistantMessages.materializeExistingCompletedAssistantMessage(result.assistantText, aux)) {
            this.options.assistantMessages.appendAssistantMessage(result.assistantText, aux);
          }
          this.options.messageTimeline?.()?.materializeCompletedAssistantText(result.assistantText, aux);
        } else {
          this.options.messageTimeline?.()?.completeActiveAssistantSegment();
        }
        this.options.setLastRuntimeError('');
        break;
      }
      case 'failed':
        this.options.clearCurrentTurnSkills();
        {
          const aux = this.options.assistantMessages.takeLatestPendingAux();
          if (!this.options.assistantMessages.materializeExistingCompletedAssistantMessage(result.error, aux)) {
            this.options.assistantMessages.appendAssistantMessage(result.error, aux);
          }
          this.options.messageTimeline?.()?.materializeCompletedAssistantText(result.error, aux);
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
        const timeline = this.options.messageTimeline?.();
        const timelinePendingAssistant = timeline
          ? timeline.beginAssistantSegment(this.options.takeNextAssistantSegmentKind?.() ?? 'initial')
          : undefined;
        if (shouldReanchorStandalonePendingAux) {
          this.options.conversationSnapshotView.reanchorPersistedStandalonePendingAux(
            timelinePendingAssistant?.id ?? pendingAssistant.id,
          );
        }
        continue;
      }
      if (event.kind === 'update-pending-assistant-thinking') {
        const timelineMessages =
          this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
        if (hasActiveRunSubagentToolInMessages(timelineMessages)) {
          continue;
        }
        this.options.assistantMessages.updatePendingAssistantAux('thinking', event.text);
        this.options.messageTimeline?.()?.updatePendingAssistantAux('thinking', event.text);
        continue;
      }
      if (event.kind === 'update-pending-assistant-compaction') {
        this.options.assistantMessages.updatePendingAssistantAux('compressing', event.text);
        this.options.messageTimeline?.()?.updatePendingAssistantAux('compressing', event.text);
        continue;
      }
      if (event.kind === 'assistant-chunk') {
        const timelineMessagesForChunk =
          this.options.messageTimeline?.()?.toMessages() ?? messages;
        if (hasActiveRunSubagentToolInMessages(timelineMessagesForChunk)) {
          continue;
        }
        this.options.assistantMessages.appendPendingAssistantChunk(event.text);
        this.options.messageTimeline?.()?.appendAssistantTextChunk(event.text);
        continue;
      }
      if (event.kind === 'replace-pending-assistant') {
        this.options.assistantMessages.replacePendingAssistantText(event.text);
        this.options.messageTimeline?.()?.replaceAssistantText(event.text);
        continue;
      }
      if (event.kind === 'assistant-response-completed') {
        this.options.assistantMessages.completePendingAssistantMessage();
        this.options.messageTimeline?.()?.completeActiveAssistantSegment();
        continue;
      }
      if (event.kind === 'remove-pending-assistant') {
        this.options.assistantMessages.removePendingAssistantMessage();
        this.options.messageTimeline?.()?.removePendingAssistantText();
        continue;
      }
      if (event.kind === 'assistant-thinking-segment-finalized') {
        if (event.text.trim()) {
          this.options.assistantMessages.appendAssistantThinkingSegment(event.text);
          this.options.messageTimeline?.()?.finalizeThinkingSegment(event.text);
        }
        continue;
      }
      if (event.kind === 'tool-call-started') {
        if (isFinishTaskToolName(event.toolName)) {
          continue;
        }
        const runningSummary =
          event.toolName === 'generate_image'
            ? { headline: i18n.t('tool.generateImage') }
            : toolCallSummaryForPhase('running', event.toolName, event.request);
        const runningTool: ToolBlockSnapshot = this.attachLineDelta(
          applyToolCallSummaryCopy(
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              phase: 'running',
              headline: runningSummary.headline,
              detailLines: [],
              argsExcerpt: truncateJson(event.request),
            },
            runningSummary,
          ),
          { request: event.request },
        );
        if (event.toolName === 'generate_image') {
          this.activeGenerateImageTools.set(event.toolCallId, runningTool);
        }
        this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
        this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
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
        this.integrateApprovalResolution(event, batchId);
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
        if (event.execution.toolName === 'generate_image' && event.execution.toolCallId) {
          this.activeGenerateImageTools.delete(event.execution.toolCallId);
        }
        this.integrateToolExecutions([event.execution], 'event');
        if (isMcpLikeToolName(event.execution.toolName)) {
          this.options.requestLiveSnapshotUpdate?.();
        }
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
      if (isFinishTaskToolName(event.toolName)) {
        const notice = finishTaskNoticePreviewFromArguments(event.argumentsJson);
        if (notice) {
          this.applyFinishTaskNoticePreview(notice);
        }
        continue;
      }
      const previewRequest = previewRequestFromStreamingArguments(
        event.toolName,
        event.argumentsJson,
      );
      const argsExcerpt = previewRequest !== undefined
        ? truncateJson(previewRequest)
        : truncateText(event.argumentsJson, 4_000);
      const previewSummary = toolCallSummaryForStreamingPreview(
        messages,
        event.toolCallId,
        event.toolName,
        previewRequest,
      );
      const runningTool: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            phase: 'preview',
            headline: previewSummary.headline,
            detailLines: [],
            argsExcerpt,
          },
          previewSummary,
        ),
        { argumentsJson: event.argumentsJson },
      );
      this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
      this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
    }
    this.logMessageOrderApplyBatch(
      batchId,
      events,
      messages,
    );
  }

  syncAssistantPrefixFromHistoryBeforeToolRow(): void {
    const runtime = this.options.runtime();
    if (!runtime) {
      return;
    }
    const messages = this.options.messageTimeline?.()?.toMessages() ?? this.options.messages();
    if (hasActiveRunSubagentToolInMessages(messages)) {
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

    if (isSubagentStatusSurfaceText(prefix)) {
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
      const insertAt = messages.length;
      const before = insertAt > 0 ? messages[insertAt - 1] : undefined;
      if (
        before?.role === 'assistant' &&
        !before.tool &&
        before.content.trim() === prefix
      ) {
        return;
      }
      this.insertAssistantPrefix(insertAt, prefix, `append-unsynced-prefix@${insertAt}`);
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
      this.options.messageTimeline?.()?.insertAssistantPrefix(prefix);
      this.logMessageOrderPrefixSync('push-after-user', messages);
      return;
    }

    if (lastMessage!.role === 'assistant' && lastMessage!.tool) {
      if (messages.some((message) => message.role === 'assistant' && !message.tool && message.content === prefix)) {
        return;
      }
      this.insertAssistantPrefix(messages.length, prefix, 'append-prefix-after-tool');
      return;
    }

    if (lastMessage!.role === 'assistant' && !lastMessage!.tool && lastMessage!.content.trim() && lastMessage!.content !== prefix) {
      if (messages.some((message) => message.role === 'assistant' && !message.tool && message.content === prefix)) {
        return;
      }
      if (!lastMessage!.content.startsWith(prefix)) {
        this.insertAssistantPrefix(messages.length, prefix, 'append-prefix-before-tail');
      }
      return;
    }
  }

  syncPendingToolStates(): void {
    const runtime = this.options.runtime();
    const approval = runtime?.currentPendingApproval();
    if (approval) {
      const approvalSummary = toolCallSummaryForPhase(
        'pending-approval',
        approval.toolName,
        approval.request,
      );
      const pendingTool: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: toolMessageKey(approval),
            toolName: approval.toolName,
            phase: 'pending-approval',
            headline: approvalSummary.headline,
            detailLines: [stripReasonLineFromShellPrompt(approval.toolName, approval.prompt)],
            argsExcerpt: truncateJson(approval.request),
          },
          approvalSummary,
        ),
        { request: approval.request },
      );
      this.options.assistantMessages.upsertToolMessage(toolMessageKey(approval), pendingTool, this.lastApplyEventBatchId);
      this.options.messageTimeline?.()?.upsertToolMessage(toolMessageKey(approval), pendingTool);
    }

    const questions = runtime?.currentPendingQuestions();
    if (questions) {
      const pendingTool: ToolBlockSnapshot = {
        toolCallId: toolMessageKey(questions),
        toolName: questions.toolName,
        phase: 'pending-approval',
        headline: i18n.t('tool.awaitingInfo', { toolName: questions.toolName }),
        detailLines: [questions.questions.title ?? i18n.t('tool.answerFormQuestions')],
        argsExcerpt: truncateJson(questions.questions),
      };
      this.options.assistantMessages.upsertToolMessage(toolMessageKey(questions), pendingTool, this.lastApplyEventBatchId);
      this.options.messageTimeline?.()?.upsertToolMessage(toolMessageKey(questions), pendingTool);
    }

    for (const [toolCallId, tool] of this.activeGenerateImageTools) {
      const runningTool: ToolBlockSnapshot = {
        ...tool,
        phase: 'running',
      };
      this.options.assistantMessages.upsertToolMessage(
        toolCallId,
        runningTool,
        this.lastApplyEventBatchId,
      );
      this.options.messageTimeline?.()?.upsertToolMessage(toolCallId, runningTool);
    }
  }

  private applyFinishTaskNoticePreview(notice: string): void {
    this.options.assistantMessages.updateFinishTaskNoticePreview(notice);
    this.options.messageTimeline?.()?.updateFinishTaskNoticePreview(notice);
  }

  private clearFinishTaskNoticePreview(): void {
    this.options.assistantMessages.clearFinishTaskNoticePreview();
    this.options.messageTimeline?.()?.clearFinishTaskNoticePreview();
  }

  private integrateToolExecutions(
    executions: RuntimeToolExecution<DesktopToolRequest>[],
    source: 'event' | 'turn-result',
  ): void {
    for (const execution of executions) {
      if (isFinishTaskToolName(execution.toolName)) {
        const toolCallId = execution.toolCallId || `tool:${execution.toolName}`;
        this.options.assistantMessages.removeToolMessage(toolCallId);
        this.options.messageTimeline?.()?.removeToolMessage(toolCallId);
        if (execution.failed) {
          this.clearFinishTaskNoticePreview();
        } else {
          const notice = finishTaskNoticeFromExecution(execution);
          if (notice) {
            this.applyFinishTaskNoticePreview(notice);
          }
        }
        continue;
      }
      if (execution.toolName === 'generate_image' && execution.toolCallId) {
        this.activeGenerateImageTools.delete(execution.toolCallId);
      }
      const imagePaths = imagePathsFromExecution(execution);
      const executionSummary =
        execution.toolName === 'generate_image'
          ? {
              headline: execution.failed ? i18n.t('tool.imageGenFailed') : i18n.t('tool.imageGenComplete'),
            }
          : toolCallSummaryForPhase(
              execution.failed ? 'failed' : 'succeeded',
              execution.toolName,
              execution.request,
            );
      const toolBlock: ToolBlockSnapshot = this.attachLineDelta(
        applyToolCallSummaryCopy(
          {
            toolCallId: execution.toolCallId || `tool:${execution.toolName}`,
            toolName: execution.toolName,
            phase: execution.failed ? 'failed' : 'succeeded',
            headline: executionSummary.headline,
            detailLines: [],
            argsExcerpt: truncateJson(execution.request),
            outputExcerpt: truncateText(execution.output, 4_000),
            ...(imagePaths.length > 0 ? { imagePaths } : {}),
          },
          executionSummary,
        ),
        { request: execution.request },
      );
      const message = this.options.assistantMessages.upsertToolMessage(
        execution.toolCallId || `tool:${execution.toolName}`,
        toolBlock,
        this.lastApplyEventBatchId,
      );
      this.options.messageTimeline?.()?.upsertToolMessage(
        execution.toolCallId || `tool:${execution.toolName}`,
        toolBlock,
      );
      if (execution.toolName === 'run_subagent') {
        this.options.conversationSnapshotView.clearStandalonePendingAuxState();
      }
      this.options.bindFileChangesToToolMessage(execution, message.id);
      if (execution.toolName.startsWith('todo_')) {
        this.options.onTodoStoreMutated?.();
      }
      this.logToolExecutionIntegration(source, execution, message.id);
    }
  }

  private logToolExecutionIntegration(
    source: 'event' | 'turn-result',
    execution: RuntimeToolExecution<DesktopToolRequest>,
    messageId: number,
  ): void {
    if (messageOrderDebugLevel() !== 'verbose') {
      return;
    }

    const messages = this.options.messages();
    const callId = execution.toolCallId || `tool:${execution.toolName}`;
    const images = imagePathsFromExecution(execution).length;
    console.log(
      `[desktop-host][tool-flow] integrate source=${source} call=${callId} name=${execution.toolName} phase=${execution.failed ? 'failed' : 'succeeded'} msg=${messageId} images=${images} tools=${summarizeToolRowsForDebug(messages, 8)} tail=${summarizeMessagesTailForOrderDebug(messages, 8)}`,
    );
  }

  private integrateApprovalResolution(
    event: Extract<RuntimeEvent<DesktopToolRequest>, { kind: 'approval-resolved' }>,
    batchId: number,
  ): void {
    const denied = event.decisionKind === 'deny' || event.decisionKind === 'guidance';
    if (denied) {
      this.activeGenerateImageTools.delete(event.toolCallId);
      this.options.assistantMessages.removeToolMessage(event.toolCallId);
      this.options.messageTimeline?.()?.removeToolMessage(event.toolCallId);
      return;
    }

    const runningSummary = toolCallSummaryForPhase('running', event.toolName, event.request);
    const runningTool: ToolBlockSnapshot = this.attachLineDelta(
      applyToolCallSummaryCopy(
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          phase: 'running',
          headline: runningSummary.headline,
          detailLines: [],
          argsExcerpt: truncateJson(event.request),
        },
        runningSummary,
      ),
      { request: event.request },
    );
    this.options.assistantMessages.upsertToolMessage(event.toolCallId, runningTool, batchId);
    this.options.messageTimeline?.()?.upsertToolMessage(event.toolCallId, runningTool);
  }

  private insertAssistantPrefix(insertAt: number, prefix: string, logLabel: string): void {
    const messages = this.options.messages();
    messages.splice(insertAt, 0, {
      id: this.options.allocateMessageId(),
      role: 'assistant',
      content: prefix,
      pending: false,
    });
    this.options.messageTimeline?.()?.insertAssistantPrefix(prefix);
    this.logMessageOrderPrefixSync(logLabel, messages);
  }

  private logMessageOrderApplyBatch(
    batchId: number,
    events: RuntimeEvent<DesktopToolRequest>[],
    messages: ConversationMessageSnapshot[],
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
      `[desktop-host][msg-order] apply#${batchId} kinds=${tags.join(',')} placement=timeline len=${messages.length} tail=${tail}`,
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

function imagePathsFromExecution(execution: RuntimeToolExecution<DesktopToolRequest>): string[] {
  return (execution.artifacts ?? [])
    .filter((artifact) => artifact.kind === 'image' && artifact.path.trim().length > 0)
    .map((artifact) => artifact.path.trim());
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

export function splitRuntimeEventsForIncrementalFinishTaskPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
): {
  toApply: RuntimeEvent<DesktopToolRequest>[];
  deferred: RuntimeEvent<DesktopToolRequest>[];
} {
  let previewIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.kind === 'streaming-tool-preview' && isFinishTaskToolName(event.toolName)) {
      previewIndex = index;
      break;
    }
  }
  if (previewIndex < 0) {
    return { toApply: events, deferred: [] };
  }
  return {
    toApply: events.slice(0, previewIndex + 1),
    deferred: events.slice(previewIndex + 1),
  };
}

export function runtimeEventsIncludeAppliedFinishTaskPreview(
  events: RuntimeEvent<DesktopToolRequest>[],
): boolean {
  return events.some(
    (event) =>
      event.kind === 'streaming-tool-preview' && isFinishTaskToolName(event.toolName),
  );
}
