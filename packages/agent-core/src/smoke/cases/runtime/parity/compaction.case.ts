import {
  AgentRuntime,
  CompactExecutor,
  CompactTransport,
  PollingCompactTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  rebuildScriptedStateAfterCompaction,
  truncateScriptedHistoryForCompaction,
  truncateScriptedStateForContextRetry,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type RuntimeTurnResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from './harness.js';

export async function runCompactionCase(): Promise<RuntimeParityCaseResult> {
  const pollingCompactEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const compactRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new CompactTransport(),
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateStateForContextRetry: truncateScriptedStateForContextRetry,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
  }, [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-old-compact', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-old-compact',
      content: createLlmMessageContentFromText('old tool output\n' + 'x'.repeat(5000)),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('旧回答。'),
    },
  ]);

  const compactResult = await compactRuntime.submitUserTurn('继续处理 runtime parity。');
  if (compactResult.kind !== 'completed' || compactResult.assistantText !== 'COMPACT_OK') {
    throw new Error('compact retry smoke 未完成闭环。');
  }

  const firstCompaction = compactResult.compactions.at(0);
  if (compactResult.compactions.length !== 1 || !firstCompaction || firstCompaction.droppedMessages <= 0) {
    throw new Error('compact retry smoke 未记录有效压缩。');
  }

  const pollingCompactTransport = new PollingCompactTransport();
  const pollingCompactRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: pollingCompactTransport,
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateStateForContextRetry: truncateScriptedStateForContextRetry,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
    maxAutoCompactRetries: 2,
    onEvent: (event) => pollingCompactEvents.push(event),
  }, [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-old-compact', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-old-compact',
      content: createLlmMessageContentFromText('old tool output\n' + 'x'.repeat(5000)),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('旧回答。'),
    },
  ]);

  await pollingCompactRuntime.startUserTurn('继续处理 runtime parity。');
  await flushMicrotasks(4);
  await pollingCompactRuntime.poll();
  await flushMicrotasks(4);
  await pollingCompactRuntime.poll();
  if (!pollingCompactRuntime.isBusy()) {
    throw new Error('polling compact smoke 应在自动压缩期间保持 busy。');
  }
  const compactAux = pollingCompactRuntime.pendingAuxState();
  if (!compactAux || compactAux.kind !== 'compressing') {
    throw new Error('polling compact smoke 未暴露 compressing aux 状态。');
  }
  if (pollingCompactRuntime.takeCompletedTurnResult()) {
    throw new Error('polling compact smoke 在压缩完成前不应产出结果。');
  }

  pollingCompactTransport.finishCompaction();
  let pollingCompactResult: RuntimeTurnResult<ScriptedState, ScriptedToolRequest, string> | undefined;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await pollingCompactRuntime.poll();
    pollingCompactResult = pollingCompactRuntime.takeCompletedTurnResult();
    if (pollingCompactResult) {
      break;
    }
  }
  if (
    !pollingCompactResult ||
    pollingCompactResult.kind !== 'completed' ||
    pollingCompactResult.assistantText !== 'COMPACT_OK'
  ) {
    throw new Error('polling compact smoke 未得到自动压缩后的最终结果。');
  }
  if (
    !pollingCompactEvents.some(
      (event) =>
        event.kind === 'update-pending-assistant-compaction' &&
        event.text.includes('[SPIRIT_COMPACT_SUMMARY] compacted history'),
    )
  ) {
    throw new Error('polling compact smoke 缺少 compaction update 事件。');
  }

  const archivePath = '/tmp/spirit-smoke-pre-compact.json';
  let persistedMessageCount = 0;
  const archiveRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new CompactTransport(),
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateStateForContextRetry: truncateScriptedStateForContextRetry,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
    hookSessionContext: {
      sessionId: 'smoke-compact-archive',
      conversationPath: null,
      workspaceRoot: '/tmp',
      model: 'test-model',
    },
    persistPreCompactionHistory: async ({ archive }) => {
      persistedMessageCount = archive.message_count;
      if (archive.messages.length === 0) {
        throw new Error('pre-compaction archive smoke 未写入任何消息。');
      }
      return archivePath;
    },
  }, [
    {
      role: 'user',
      content: createLlmMessageContentFromText('first user turn'),
    },
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-archive', name: 'read_file', argumentsJson: '{"path":"a.ts"}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-archive',
      content: createLlmMessageContentFromText('tool output should be omitted from archive'),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('assistant follow-up'),
    },
  ]);

  const archiveRecord = await archiveRuntime.compactHistory();
  if (archiveRecord.preCompactionArchivePath !== archivePath) {
    throw new Error('pre-compaction archive smoke 未记录归档路径。');
  }
  if (persistedMessageCount !== 3) {
    throw new Error(`pre-compaction archive smoke 归档消息数异常: ${persistedMessageCount}`);
  }

  return {
    compactResult,
    pollingCompactResult,
    archiveCompactionResult: archiveRecord,
  };
}
