import {
  AgentRuntime,
  BackgroundExecutor,
  CompactExecutor,
  HostExecutor,
  PollingBackgroundExecutor,
  StreamingApprovalExecutor,
  StreamingApprovalGuidanceTransport,
  StreamingApprovalImageExecutor,
  StreamingApprovalImageTransport,
  StreamingApprovalTransport,
  StreamingBackgroundRoundTransport,
  StreamingCompactionTransport,
  StreamingFailureTransport,
  StreamingFinalTransport,
  StreamingTimeoutTransport,
  StreamingToolRoundTransport,
  appendScriptedToolResult,
  appendScriptedUserLlmMessage,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  isJsonObject,
  llmMessageImagePaths,
  llmMessageTextContent,
  rebuildScriptedStateAfterCompaction,
  truncateScriptedHistoryForCompaction,
  truncateScriptedStateForContextRetry,
  type LlmMessage,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedToolRequest,
} from './harness.js';

export async function runStreamingCase(): Promise<RuntimeParityCaseResult> {
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingCompactionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalImageEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingGuidanceEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const timeoutEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingFailureEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const streamingRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFinalTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingEvents.push(event),
  });

  await streamingRuntime.startUserTurnStreaming('请流式输出');
  for (let index = 0; index < 24 && streamingRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingRuntime.poll();
  }

  if (streamingRuntime.isBusy()) {
    throw new Error('streaming final smoke 未在预期轮次内完成。');
  }

  const drainedStreamingEvents = streamingRuntime.drainEvents();
  if (!drainedStreamingEvents.some((event) => event.kind === 'begin-assistant-response')) {
    throw new Error('streaming final smoke 缺少 begin event。');
  }
  if (
    !drainedStreamingEvents.some(
      (event) => event.kind === 'update-pending-assistant-thinking' && event.text.includes('searching workspace'),
    )
  ) {
    throw new Error('streaming final smoke 缺少 thinking/tool-progress 聚合事件。');
  }
  if (
    drainedStreamingEvents.filter((event) => event.kind === 'assistant-chunk').length < 2
  ) {
    throw new Error('streaming final smoke 缺少 assistant chunk 事件。');
  }
  if (!drainedStreamingEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('streaming final smoke 缺少 completed event。');
  }

  const timeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingTimeoutTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => timeoutEvents.push(event),
  });

  await timeoutRuntime.startUserTurnStreaming('请等待超时');
  await flushMicrotasks();
  await timeoutRuntime.poll();
  timeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  const drainedTimeoutEvents = timeoutRuntime.drainEvents();
  if (
    !drainedTimeoutEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text.includes('[stream timeout]'),
    )
  ) {
    throw new Error('stream timeout smoke 未产生 timeout chunk。');
  }
  if (!drainedTimeoutEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('stream timeout smoke 未完成 pending response。');
  }
  if (timeoutRuntime.pendingUserTurn() !== undefined) {
    throw new Error('stream timeout smoke 结束后未清空 pending user turn。');
  }

  const streamingFailureRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFailureTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingFailureEvents.push(event),
  });

  await streamingFailureRuntime.startUserTurnStreaming('请触发流式失败');
  for (let index = 0; index < 8 && streamingFailureRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingFailureRuntime.poll();
  }
  if (streamingFailureRuntime.isBusy()) {
    throw new Error('streaming failure smoke 未在预期轮次内完成。');
  }
  if (streamingFailureRuntime.pendingUserTurn() !== undefined) {
    throw new Error('streaming failure smoke 结束后未清空 pending user turn。');
  }
  const drainedStreamingFailureEvents = streamingFailureRuntime.drainEvents();
  if (
    !drainedStreamingFailureEvents.some(
      (event) =>
        event.kind === 'replace-pending-assistant' &&
        event.text.includes('invalid chat setting (2013)'),
    )
  ) {
    throw new Error('streaming failure smoke 未输出预期错误消息。');
  }
  if (
    !drainedStreamingFailureEvents.some(
      (event) => event.kind === 'assistant-response-completed',
    )
  ) {
    throw new Error('streaming failure smoke 缺少 completed event。');
  }

  const streamingApprovalExecutor = new StreamingApprovalExecutor();
  const streamingApprovalRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalTransport(),
    toolExecutor: streamingApprovalExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingApprovalEvents.push(event),
  });

  await streamingApprovalRuntime.startUserTurnStreaming('请流式审批后继续');
  await flushMicrotasks(4);
  await streamingApprovalRuntime.poll();
  if (!streamingApprovalRuntime.hasPendingApproval()) {
    throw new Error('streaming approval smoke 未进入待审批状态。');
  }

  await streamingApprovalRuntime.continuePendingApproval({ kind: 'allow' });
  for (let index = 0; index < 12 && streamingApprovalRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalRuntime.poll();
  }
  if (streamingApprovalRuntime.isBusy()) {
    throw new Error('streaming approval smoke 未在预期轮次内完成。');
  }

  const drainedStreamingApprovalEvents = streamingApprovalRuntime.drainEvents();
  if (
    drainedStreamingApprovalEvents.filter((event) => event.kind === 'begin-assistant-response').length < 2
  ) {
    throw new Error('streaming approval smoke 应包含审批前后两次 begin event。');
  }
  if (
    !drainedStreamingApprovalEvents.some(
      (event) => event.kind === 'approval-requested' && event.approval.toolName === 'create_file',
    )
  ) {
    throw new Error('streaming approval smoke 缺少 approval-requested 事件。');
  }
  if (
    !drainedStreamingApprovalEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text === 'STREAM_APPROVAL_',
    )
  ) {
    throw new Error('streaming approval smoke 缺少审批恢复后的流式 chunk。');
  }
  if (streamingApprovalExecutor.executedCalls !== 1) {
    throw new Error('streaming approval smoke 工具执行次数不正确。');
  }
  const streamingApprovalTrace = streamingApprovalRuntime.requestTrace();
  if (
    !streamingApprovalTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-approval-round-2',
    )
  ) {
    throw new Error('streaming approval smoke 缺少审批恢复后的 streaming trace。');
  }
  if (
    streamingApprovalTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-approval-sync-fallback',
    )
  ) {
    throw new Error('streaming approval smoke 错误退回到了非流式 round。');
  }

  const streamingApprovalImageExecutor = new StreamingApprovalImageExecutor();
  const streamingApprovalImageRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalImageTransport(),
    toolExecutor: streamingApprovalImageExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    appendUserLlmMessage: appendScriptedUserLlmMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingApprovalImageEvents.push(event),
  });

  await streamingApprovalImageRuntime.startUserTurnStreaming('请审批后读取图片');
  await flushMicrotasks(4);
  await streamingApprovalImageRuntime.poll();
  if (!streamingApprovalImageRuntime.hasPendingApproval()) {
    throw new Error('streaming approval image smoke 未进入待审批状态。');
  }

  await streamingApprovalImageRuntime.continuePendingApproval({ kind: 'allow' });
  for (let index = 0; index < 12 && streamingApprovalImageRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalImageRuntime.poll();
  }
  if (streamingApprovalImageRuntime.isBusy()) {
    throw new Error('streaming approval image smoke 未在预期轮次内完成。');
  }

  const drainedStreamingApprovalImageEvents = streamingApprovalImageRuntime.drainEvents();
  if (
    drainedStreamingApprovalImageEvents.filter((event) => event.kind === 'begin-assistant-response').length < 2
  ) {
    throw new Error('streaming approval image smoke 应包含审批前后两次 begin event。');
  }
  if (
    !drainedStreamingApprovalImageEvents.some(
      (event) => event.kind === 'approval-requested' && event.approval.toolName === 'read_file',
    )
  ) {
    throw new Error('streaming approval image smoke 缺少 approval-requested 事件。');
  }
  if (
    !drainedStreamingApprovalImageEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text === 'STREAM_APPROVAL_IMAGE_',
    )
  ) {
    throw new Error('streaming approval image smoke 缺少审批恢复后的流式 chunk。');
  }
  if (streamingApprovalImageExecutor.executedCalls !== 1) {
    throw new Error('streaming approval image smoke 工具执行次数不正确。');
  }
  const streamingApprovalImageTrace = streamingApprovalImageRuntime.requestTrace();
  if (
    !streamingApprovalImageTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-approval-image-round-2',
    )
  ) {
    throw new Error('streaming approval image smoke 缺少审批恢复后的 streaming trace。');
  }
  if (
    streamingApprovalImageTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-approval-image-sync-fallback',
    )
  ) {
    throw new Error('streaming approval image smoke 错误退回到了非流式 round。');
  }
  if (
    !streamingApprovalImageRuntime.history().some(
      (message) =>
        message.role === 'user' &&
        llmMessageTextContent(message.content).includes('[read image]') &&
        llmMessageImagePaths(message.content).includes('approved-image.png'),
    )
  ) {
    throw new Error('streaming approval image smoke 未把图片投影写入历史。');
  }

  const streamingGuidanceExecutor = new StreamingApprovalExecutor();
  const streamingGuidanceRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalGuidanceTransport(),
    toolExecutor: streamingGuidanceExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingGuidanceEvents.push(event),
  });

  await streamingGuidanceRuntime.startUserTurnStreaming('请流式审批后改成总结');
  await flushMicrotasks(4);
  await streamingGuidanceRuntime.poll();
  if (!streamingGuidanceRuntime.hasPendingApproval()) {
    throw new Error('streaming guidance smoke 未进入待审批状态。');
  }

  await streamingGuidanceRuntime.continuePendingApproval({
    kind: 'guidance',
    userMessage: '不要写文件，直接总结',
  });
  for (let index = 0; index < 12 && streamingGuidanceRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingGuidanceRuntime.poll();
  }
  if (streamingGuidanceRuntime.isBusy()) {
    throw new Error('streaming guidance smoke 未在预期轮次内完成。');
  }

  const drainedStreamingGuidanceEvents = streamingGuidanceRuntime.drainEvents();
  if (
    drainedStreamingGuidanceEvents.filter((event) => event.kind === 'begin-assistant-response').length < 2
  ) {
    throw new Error('streaming guidance smoke 应包含审批前后两次 begin event。');
  }
  if (
    !drainedStreamingGuidanceEvents.some(
      (event) => event.kind === 'approval-requested' && event.approval.toolName === 'create_file',
    )
  ) {
    throw new Error('streaming guidance smoke 缺少 approval-requested 事件。');
  }
  if (
    !drainedStreamingGuidanceEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text === 'STREAM_GUIDANCE_',
    )
  ) {
    throw new Error('streaming guidance smoke 缺少审批恢复后的流式 chunk。');
  }
  if (streamingGuidanceExecutor.executedCalls !== 1) {
    throw new Error('streaming guidance smoke 应继续执行后续排队工具。');
  }
  const streamingGuidanceTrace = streamingGuidanceRuntime.requestTrace();
  if (
    !streamingGuidanceTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-guidance-round-2',
    )
  ) {
    throw new Error('streaming guidance smoke 缺少审批恢复后的 streaming trace。');
  }
  if (
    streamingGuidanceTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === 'streaming-guidance-sync-fallback',
    )
  ) {
    throw new Error('streaming guidance smoke 错误退回到了非流式 round。');
  }

  const streamingBackgroundExecutor = new PollingBackgroundExecutor();
  const streamingBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingBackgroundRoundTransport(),
    toolExecutor: streamingBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingBackgroundEvents.push(event),
  });

  await streamingBackgroundRuntime.startUserTurnStreaming('请流式走后台工具');
  await flushMicrotasks(4);
  await streamingBackgroundRuntime.poll();
  if (!streamingBackgroundRuntime.isBusy()) {
    throw new Error('streaming background smoke 应在后台工具执行期间保持 busy。');
  }
  const streamingBackgroundAux = streamingBackgroundRuntime.pendingAuxState();
  if (
    !streamingBackgroundAux ||
    streamingBackgroundAux.kind !== 'thinking' ||
    streamingBackgroundAux.detailText !== '搜索中: runtime parity'
  ) {
    throw new Error('streaming background smoke 未暴露 thinking aux 状态。');
  }

  streamingBackgroundExecutor.finish('background result for {"query":"runtime parity"}');
  for (let index = 0; index < 12 && streamingBackgroundRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingBackgroundRuntime.poll();
  }
  if (streamingBackgroundRuntime.isBusy()) {
    throw new Error('streaming background smoke 未在预期轮次内完成。');
  }
  const drainedStreamingBackgroundEvents = streamingBackgroundRuntime.drainEvents();
  if (
    drainedStreamingBackgroundEvents.filter((event) => event.kind === 'begin-assistant-response').length < 2
  ) {
    throw new Error('streaming background smoke 应包含两次 begin event。');
  }
  if (
    !drainedStreamingBackgroundEvents.some(
      (event) => event.kind === 'background-tool-status' && event.phase === 'started',
    )
  ) {
    throw new Error('streaming background smoke 缺少后台开始事件。');
  }
  if (
    !drainedStreamingBackgroundEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text === 'STREAM_BG_',
    )
  ) {
    throw new Error('streaming background smoke 缺少恢复后的流式 chunk。');
  }

  const streamingCompactionTransport = new StreamingCompactionTransport();
  const streamingCompactionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: streamingCompactionTransport,
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateStateForContextRetry: truncateScriptedStateForContextRetry,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
    maxAutoCompactRetries: 2,
    onEvent: (event) => streamingCompactionEvents.push(event),
  }, [
    {
      role: 'system',
      content: createLlmMessageContentFromText('[TOOL_MEMORY]\nrequest: old\nresult_snippet:\n' + 'x'.repeat(5000)),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('旧回答。'),
    },
  ]);

  await streamingCompactionRuntime.startUserTurnStreaming('请流式处理超长上下文');
  await flushMicrotasks(4);
  await streamingCompactionRuntime.poll();
  const streamingCompactionAux = streamingCompactionRuntime.pendingAuxState();
  if (!streamingCompactionAux || streamingCompactionAux.kind !== 'compressing') {
    throw new Error('streaming compact smoke 未进入 compressing aux 状态。');
  }

  streamingCompactionTransport.finishCompaction();
  for (let index = 0; index < 12 && streamingCompactionRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingCompactionRuntime.poll();
  }
  if (streamingCompactionRuntime.isBusy()) {
    throw new Error('streaming compact smoke 未在预期轮次内完成。');
  }
  const drainedStreamingCompactionEvents = streamingCompactionRuntime.drainEvents();
  if (
    drainedStreamingCompactionEvents.filter((event) => event.kind === 'begin-assistant-response').length !== 1
  ) {
    throw new Error('streaming compact smoke 在自动压缩重试后不应额外发出 begin event。');
  }
  if (
    !drainedStreamingCompactionEvents.some(
      (event) =>
        event.kind === 'update-pending-assistant-compaction' &&
        event.text.includes('[SPIRIT_COMPACT_SUMMARY] compacted history'),
    )
  ) {
    throw new Error('streaming compact smoke 缺少 compaction update 事件。');
  }
  if (
    !drainedStreamingCompactionEvents.some(
      (event) => event.kind === 'assistant-chunk' && event.text === 'STREAM_COMPACT_',
    )
  ) {
    throw new Error('streaming compact smoke 缺少压缩后恢复的流式 chunk。');
  }

  const toolRoundTransport = new StreamingToolRoundTransport();
  const noTimeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: toolRoundTransport,
    toolExecutor: new BackgroundExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  await noTimeoutRuntime.startUserTurnStreaming('这是一个 tool round');
  noTimeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  if (!noTimeoutRuntime.isBusy()) {
    throw new Error('tool round timeout smoke 不应在 decision 未完成时超时退出。');
  }
  toolRoundTransport.finish(createScriptedState(noTimeoutRuntime.history() as LlmMessage[], '这是一个 tool round'));
  await flushMicrotasks();
  await noTimeoutRuntime.poll();

  return { drainedStreamingEvents, drainedTimeoutEvents, drainedStreamingFailureEvents, drainedStreamingApprovalEvents, drainedStreamingApprovalImageEvents, drainedStreamingGuidanceEvents, drainedStreamingBackgroundEvents, drainedStreamingCompactionEvents };
}
