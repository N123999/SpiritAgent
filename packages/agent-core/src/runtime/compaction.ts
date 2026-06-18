import { setImmediate as waitForImmediate } from 'node:timers/promises';

import { buildPreCompactionHistoryArchive } from '../compaction-archive.js';
import type { CompactHistoryManualContext, LlmMessage } from '../ports.js';
import { resolveHookSessionContext } from '../hooks/integration.js';
import {
  prepareToolOutputTruncationForHistory,
  prepareToolOutputTruncationForToolAgentState,
} from '../tool-output-truncation.js';

import { cloneHistory, renderError } from './helpers.js';
import type {
  AgentRuntimeOptions,
  PendingHistoryCompaction,
  PendingManualHistoryCompaction,
  PendingAutoHistoryCompaction,
  RuntimeCompactionRecord,
  RuntimeEvent,
  RuntimeManualHistoryCompactionResult,
  RuntimeTurnContext,
  RuntimeTurnResult,
} from './types.js';

export interface CompactionRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  compactionTextStore: string;
  pendingHistoryCompaction: PendingHistoryCompaction<State, ToolRequest> | undefined;
  completedManualHistoryCompactionResultStore:
    | RuntimeManualHistoryCompactionResult
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  completeTurn(result: RuntimeTurnResult<State, ToolRequest, TrustTarget>): void;
  startToolAgentRoundAsync(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emptyAssistantRetries?: number,
  ): void;
  startStreamingRound(
    state: State,
    pendingUserInput: string,
    turn: RuntimeTurnContext<ToolRequest>,
    emitBeginResponse: boolean,
  ): Promise<void>;
  takeCompletedManualHistoryCompactionResult(): RuntimeManualHistoryCompactionResult | undefined;
  isBusy(): boolean;
  poll(): Promise<void>;
}

async function removeOrphanPreCompactionArchive<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
  archivePath: string | undefined,
): Promise<void> {
  const remove = runtime.options.removePreCompactionHistoryArchive;
  if (!archivePath || !remove) {
    return;
  }

  try {
    await remove(archivePath);
  } catch {
    // Best-effort cleanup when compaction fails after a successful persist.
  }
}

async function persistPreCompactionArchivePath<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
  archiveSourceHistory: LlmMessage[],
): Promise<string | undefined> {
  const persist = runtime.options.persistPreCompactionHistory;
  if (!persist) {
    return undefined;
  }

  try {
    const archive = buildPreCompactionHistoryArchive(archiveSourceHistory);
    const sessionId = resolveHookSessionContext(runtime.options).sessionId;
    return await persist({
      archive,
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  } catch (error: unknown) {
    runtime.emitEvent({
      kind: 'pre-compaction-archive-persist-failed',
      error: renderError(error),
    });
    return undefined;
  }
}

function buildCompactionRecord(
  result: {
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  },
  summary: string | undefined,
  preCompactionArchivePath: string | undefined,
): RuntimeCompactionRecord {
  return {
    droppedMessages: result.droppedMessages,
    beforeLength: result.beforeLength,
    afterLength: result.afterLength,
    ...(summary !== undefined ? { summary } : {}),
    ...(preCompactionArchivePath !== undefined ? { preCompactionArchivePath } : {}),
  };
}

function shouldPrepareToolOutputTruncation<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>): boolean {
  return (
    runtime.options.truncateHistoryForCompaction !== undefined ||
    runtime.options.persistToolOutputArchive !== undefined
  );
}

export async function prepareStateForContextRetryAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  state: State,
): Promise<{ state: State; changed: boolean }> {
  if (
    !options.truncateStateForContextRetry &&
    !options.persistToolOutputArchive
  ) {
    return { state, changed: false };
  }

  const sessionId = resolveHookSessionContext(options).sessionId;
  const prepareOptions = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(options.persistToolOutputArchive !== undefined
      ? { persistArchive: options.persistToolOutputArchive }
      : {}),
  };
  return prepareToolOutputTruncationForToolAgentState(state as never, prepareOptions) as Promise<{
    state: State;
    changed: boolean;
  }>;
}

async function prepareHistoryForCompaction<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
  archiveSourceHistory: LlmMessage[],
): Promise<LlmMessage[]> {
  if (!shouldPrepareToolOutputTruncation(runtime)) {
    return cloneHistory(archiveSourceHistory);
  }

  const sessionId = resolveHookSessionContext(runtime.options).sessionId;
  const prepareOptions = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(runtime.options.persistToolOutputArchive !== undefined
      ? { persistArchive: runtime.options.persistToolOutputArchive }
      : {}),
  };
  const prepared = await prepareToolOutputTruncationForHistory(archiveSourceHistory, prepareOptions);
  return cloneHistory(prepared.history);
}

export async function compactHistoryImmediate<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<RuntimeCompactionRecord> {
  const archiveSourceHistory = cloneHistory(runtime.historyStore);
  const preCompactionArchivePath = await persistPreCompactionArchivePath(
    runtime,
    archiveSourceHistory,
  );
  const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
  runtime.historyStore = cloneHistory(historyForCompaction);

  const compactionContext: CompactHistoryManualContext | undefined =
    preCompactionArchivePath !== undefined
      ? { preCompactionArchivePath }
      : undefined;

  try {
    const result = await runtime.options.llmTransport.compactHistoryManual(
      runtime.options.config,
      runtime.historyStore,
      undefined,
      compactionContext,
    );
    const summary = runtime.options.llmTransport.compactSummaryText(runtime.historyStore);
    return buildCompactionRecord(result, summary, preCompactionArchivePath);
  } catch (error: unknown) {
    await removeOrphanPreCompactionArchive(runtime, preCompactionArchivePath);
    throw error;
  }
}

export function startHistoryCompactionAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
  retryState: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
  originalError: string,
  toolTruncationApplied: boolean,
  resumeAsStreaming = false,
  streamingEmitBeginResponse = true,
): void {
  void (async () => {
    const archiveSourceHistory = cloneHistory(runtime.historyStore);
    const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
    runtime.historyStore = cloneHistory(historyForCompaction);

    runtime.compactionTextStore = '';
    const pending: PendingAutoHistoryCompaction<State, ToolRequest> = {
      kind: 'auto-retry',
      pendingUserInput,
      retryState,
      turn,
      originalError,
      toolTruncationApplied,
      resumeAsStreaming,
      streamingEmitBeginResponse,
      compactedHistory: undefined,
      result: undefined,
      failure: undefined,
    };
    launchHistoryCompaction(runtime, pending, historyForCompaction, archiveSourceHistory);
  })();
}

export function startManualHistoryCompactionAsync<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
): void {
  void (async () => {
    const archiveSourceHistory = cloneHistory(runtime.historyStore);
    const historyForCompaction = await prepareHistoryForCompaction(runtime, archiveSourceHistory);
    runtime.historyStore = cloneHistory(historyForCompaction);

    runtime.compactionTextStore = '';
    const pending: PendingManualHistoryCompaction = {
      kind: 'manual',
      compactedHistory: undefined,
      result: undefined,
      failure: undefined,
    };
    launchHistoryCompaction(runtime, pending, historyForCompaction, archiveSourceHistory);
  })();
}

export function launchHistoryCompaction<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
  pending: PendingHistoryCompaction<State, ToolRequest>,
  history: LlmMessage[],
  archiveSourceHistory: LlmMessage[],
): void {
  runtime.pendingHistoryCompaction = pending;

  void (async () => {
    let preCompactionArchivePath: string | undefined;
    try {
      preCompactionArchivePath = await persistPreCompactionArchivePath(
        runtime,
        archiveSourceHistory,
      );
      const compactionContext: CompactHistoryManualContext | undefined =
        preCompactionArchivePath !== undefined
          ? { preCompactionArchivePath }
          : undefined;

      const result = await runtime.options.llmTransport.compactHistoryManual(
        runtime.options.config,
        history,
        (chunk) => {
          if (runtime.pendingHistoryCompaction !== pending || !chunk) {
            return;
          }

          runtime.compactionTextStore += chunk;
          runtime.emitEvent({
            kind: 'update-pending-assistant-compaction',
            text: runtime.compactionTextStore,
          });
        },
        compactionContext,
      );

      if (runtime.pendingHistoryCompaction !== pending) {
        return;
      }

      const summary = runtime.options.llmTransport.compactSummaryText(history);
      pending.compactedHistory = cloneHistory(history);
      pending.result = buildCompactionRecord(result, summary, preCompactionArchivePath);
    } catch (error: unknown) {
      if (runtime.pendingHistoryCompaction === pending) {
        await removeOrphanPreCompactionArchive(runtime, preCompactionArchivePath);
        pending.failure = renderError(error);
      }
    }
  })();
}

export async function pollPendingHistoryCompaction<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<void> {
  const pending = runtime.pendingHistoryCompaction;
  if (!pending || (pending.result === undefined && pending.failure === undefined)) {
    return;
  }

  runtime.pendingHistoryCompaction = undefined;
  if (pending.kind === 'manual') {
    if (pending.failure !== undefined) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: `压缩失败: ${pending.failure}`,
      });
      runtime.emitEvent({ kind: 'assistant-response-completed' });
      runtime.compactionTextStore = '';
      runtime.completedManualHistoryCompactionResultStore = {
        kind: 'failed',
        error: `压缩失败: ${pending.failure}`,
      };
      return;
    }

    const result = pending.result;
    const compactedHistory = pending.compactedHistory;
    if (!result || !compactedHistory) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: '压缩失败: 未产生有效结果',
      });
      runtime.emitEvent({ kind: 'assistant-response-completed' });
      runtime.compactionTextStore = '';
      runtime.completedManualHistoryCompactionResultStore = {
        kind: 'failed',
        error: '压缩失败: 未产生有效结果',
      };
      return;
    }

    runtime.historyStore = compactedHistory;
    if (!runtime.compactionTextStore.trim() && result.summary?.trim()) {
      runtime.compactionTextStore = result.summary;
      runtime.emitEvent({
        kind: 'update-pending-assistant-compaction',
        text: runtime.compactionTextStore,
      });
    }

    runtime.emitEvent({
      kind: 'replace-pending-assistant',
      text:
        result.droppedMessages === 0
          ? '当前可压缩历史较少，已跳过压缩。'
          : `压缩完成：上下文消息 ${result.beforeLength} -> ${result.afterLength}，已合并 ${result.droppedMessages} 条历史消息。`,
    });
    runtime.emitEvent({ kind: 'assistant-response-completed' });
    runtime.compactionTextStore = '';
    runtime.completedManualHistoryCompactionResultStore = {
      kind: 'completed',
      result,
    };
    return;
  }

  if (pending.failure !== undefined) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: `上下文压缩失败: ${pending.failure} | 原始错误: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    } else {
      runtime.completeTurn({
        kind: 'failed',
        error: `上下文压缩失败: ${pending.failure} | 原始错误: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  const result = pending.result;
  const compactedHistory = pending.compactedHistory;
  if (!result || !compactedHistory) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: `上下文压缩失败: 未产生有效结果 | 原始错误: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    } else {
      runtime.completeTurn({
        kind: 'failed',
        error: `上下文压缩失败: 未产生有效结果 | 原始错误: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  runtime.historyStore = compactedHistory;
  pending.turn.compactions.push(result);
  if (!runtime.compactionTextStore.trim() && result.summary?.trim()) {
    runtime.compactionTextStore = result.summary;
    runtime.emitEvent({
      kind: 'update-pending-assistant-compaction',
      text: runtime.compactionTextStore,
    });
  }

  if (result.droppedMessages === 0 && !pending.toolTruncationApplied) {
    if (pending.resumeAsStreaming) {
      runtime.emitEvent({
        kind: 'replace-pending-assistant',
        text: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${pending.originalError}`,
      });
      runtime.emitEvent({ kind: 'assistant-response-completed' });
    } else {
      runtime.completeTurn({
        kind: 'failed',
        error: `检测到上下文超限，但历史已无法继续压缩。原始错误: ${pending.originalError}`,
        state: pending.retryState,
        requestTrace: [...pending.turn.requestTrace],
        toolExecutions: [...pending.turn.toolExecutions],
        compactions: [...pending.turn.compactions],
      });
    }
    return;
  }

  const nextState =
    result.droppedMessages === 0
      ? pending.retryState
      : runtime.options.rebuildRetryStateAfterCompaction
        ? runtime.options.rebuildRetryStateAfterCompaction(
            runtime.historyStore,
            pending.pendingUserInput,
            pending.retryState,
          )
        : runtime.options.createToolAgentState(runtime.historyStore, pending.pendingUserInput);

  if (pending.resumeAsStreaming) {
    await runtime.startStreamingRound(
      nextState,
      pending.pendingUserInput,
      pending.turn,
      pending.streamingEmitBeginResponse,
    );
    return;
  }

  runtime.startToolAgentRoundAsync(nextState, pending.pendingUserInput, pending.turn);
}

export async function waitForCompletedManualHistoryCompactionResult<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: CompactionRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<RuntimeManualHistoryCompactionResult> {
  while (true) {
    const existing = runtime.takeCompletedManualHistoryCompactionResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出手动压缩结果时提前进入空闲状态。');
    }

    await runtime.poll();

    const result = runtime.takeCompletedManualHistoryCompactionResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出手动压缩结果时提前进入空闲状态。');
    }

    await waitForImmediate();
  }
}
