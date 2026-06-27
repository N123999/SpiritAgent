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
  SubagentExecutor,
  appendScriptedToolResult,
  appendScriptedUserLlmMessage,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  historyAsPlainApiMessages,
  isJsonObject,
  llmMessageImagePaths,
  llmMessageTextContent,
  rebuildScriptedStateAfterCompaction,
  streamFromEvents,
  truncateScriptedHistoryForCompaction,
  truncateScriptedStateForContextRetry,
  type LlmMessage,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from './harness.js';
import type {
  JsonValue,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutionOutput,
} from '../../../../ports.js';

export async function runStreamingCase(): Promise<RuntimeParityCaseResult> {
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingCompactionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalImageEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalThenImageEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingGuidanceEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const timeoutEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingFailureEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewEarlyExecutionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewBackgroundDeferredEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewSubagentDeferredEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const authorizationFailureEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

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
      (event) => event.kind === 'update-pending-assistant-thinking' && event.text.includes('thinking...'),
    )
  ) {
    throw new Error('streaming final smoke 缺少 thinking 聚合事件。');
  }
  if (
    drainedStreamingEvents.filter((event) => event.kind === 'assistant-chunk').length < 2
  ) {
    throw new Error('streaming final smoke 缺少 assistant chunk 事件。');
  }
  if (!drainedStreamingEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('streaming final smoke 缺少 completed event。');
  }

  const previewEarlyExecutionTransport = new PreviewEarlyExecutionTransport();
  const previewEarlyExecutionExecutor = new CountingReadFileExecutor();
  const previewEarlyExecutionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewEarlyExecutionTransport,
    toolExecutor: previewEarlyExecutionExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewEarlyExecutionEvents.push(event),
  });

  await previewEarlyExecutionRuntime.startUserTurnStreaming('请预览后读取文件');
  for (let index = 0; index < 8 && previewEarlyExecutionExecutor.executedCalls === 0; index += 1) {
    await flushMicrotasks(4);
    await previewEarlyExecutionRuntime.poll();
  }
  if (previewEarlyExecutionExecutor.executedCalls !== 1) {
    throw new Error('preview early execution smoke 未在正式 tool-calls completion 前执行工具。');
  }
  if (previewEarlyExecutionTransport.toolCallRoundResolved) {
    throw new Error('preview early execution smoke 在正式 tool-calls completion 前不应已 resolve。');
  }
  if (
    !previewEarlyExecutionEvents.some(
      (event) => event.kind === 'tool-execution-finished' && event.execution.toolCallId === 'call-preview-read',
    )
  ) {
    throw new Error('preview early execution smoke 未在 preview 后发出工具完成事件。');
  }

  previewEarlyExecutionTransport.resolveToolCallRound();
  for (let index = 0; index < 16 && previewEarlyExecutionRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewEarlyExecutionRuntime.poll();
  }
  if (previewEarlyExecutionRuntime.isBusy()) {
    throw new Error('preview early execution smoke 未在预期轮次内完成。');
  }
  const previewEarlyExecutionResult = previewEarlyExecutionRuntime.takeCompletedTurnResult();
  if (
    !previewEarlyExecutionResult ||
    previewEarlyExecutionResult.kind !== 'completed' ||
    previewEarlyExecutionResult.assistantText !== 'PREVIEW_EARLY_OK'
  ) {
    throw new Error('preview early execution smoke 未完成最终 assistant 轮次。');
  }
  if (previewEarlyExecutionExecutor.executedCalls !== 1) {
    throw new Error('preview early execution smoke 重复执行了工具。');
  }
  const previewToolExecutions = previewEarlyExecutionResult.toolExecutions.filter(
    (execution) => execution.toolCallId === 'call-preview-read',
  );
  if (previewToolExecutions.length !== 1) {
    throw new Error('preview early execution smoke 未复用预览阶段工具结果。');
  }

  const previewBackgroundTransport = new PreviewBackgroundDeferredTransport();
  const previewBackgroundExecutor = new CountingBackgroundExecutor();
  const previewBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewBackgroundTransport,
    toolExecutor: previewBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewBackgroundDeferredEvents.push(event),
  });

  await previewBackgroundRuntime.startUserTurnStreaming('请预览后后台搜索');
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await previewBackgroundRuntime.poll();
  }
  if (previewBackgroundExecutor.executedCalls !== 0) {
    throw new Error('preview background smoke 不应在正式 tool-calls completion 前启动后台工具。');
  }
  if (
    previewBackgroundDeferredEvents.some(
      (event) => event.kind === 'tool-call-started' && event.toolCallId === 'call-preview-background',
    )
  ) {
    throw new Error('preview background smoke 不应在 formal path 前发出 tool-call-started。');
  }
  if (
    previewBackgroundDeferredEvents.some(
      (event) => event.kind === 'background-tool-status' && event.toolName === 'grep',
    )
  ) {
    throw new Error('preview background smoke 不应在 formal path 前发出后台状态事件。');
  }

  previewBackgroundTransport.resolveToolCallRound();
  for (let index = 0; index < 20 && previewBackgroundRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewBackgroundRuntime.poll();
  }
  if (previewBackgroundRuntime.isBusy()) {
    throw new Error('preview background smoke 未在预期轮次内完成。');
  }
  if (Number(previewBackgroundExecutor.executedCalls) !== 1) {
    throw new Error('preview background smoke 应只在 formal path 执行一次后台工具。');
  }
  if (
    previewBackgroundDeferredEvents.filter(
      (event) => event.kind === 'tool-call-started' && event.toolCallId === 'call-preview-background',
    ).length !== 1
  ) {
    throw new Error('preview background smoke formal path 的 tool-call-started 次数不正确。');
  }

  const previewSubagentTransport = new PreviewSubagentDeferredTransport();
  const previewSubagentExecutor = new SubagentExecutor();
  const previewSubagentRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewSubagentTransport,
    toolExecutor: previewSubagentExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewSubagentDeferredEvents.push(event),
  });

  await previewSubagentRuntime.startUserTurnStreaming('请预览后委托子代理');
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await previewSubagentRuntime.poll();
  }
  if (
    previewSubagentDeferredEvents.some(
      (event) => event.kind === 'tool-call-started' && event.toolCallId === 'call-preview-subagent',
    )
  ) {
    throw new Error('preview subagent smoke 不应在 defer-to-formal 前发出 tool-call-started。');
  }

  previewSubagentTransport.resolveToolCallRound();
  for (let index = 0; index < 24 && previewSubagentRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewSubagentRuntime.poll();
  }
  if (previewSubagentRuntime.isBusy()) {
    throw new Error('preview subagent smoke 未在预期轮次内完成。');
  }
  if (previewSubagentExecutor.executedSubagentCalls !== 0) {
    throw new Error('preview subagent smoke 错误落到了宿主 execute。');
  }
  if (
    previewSubagentDeferredEvents.filter(
      (event) => event.kind === 'tool-call-started' && event.toolCallId === 'call-preview-subagent',
    ).length !== 1
  ) {
    throw new Error('preview subagent smoke 的 tool-call-started 不应重复。');
  }

  const authorizationFailureRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new AuthorizationFailureTransport(),
    toolExecutor: new AuthorizationFailureExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => authorizationFailureEvents.push(event),
  });

  await authorizationFailureRuntime.startUserTurnStreaming('请读取不存在的文件');
  for (let index = 0; index < 12 && authorizationFailureRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await authorizationFailureRuntime.poll();
  }
  if (authorizationFailureRuntime.isBusy()) {
    throw new Error('authorization failure smoke 未在预期轮次内完成。');
  }

  const drainedAuthorizationFailureEvents = authorizationFailureRuntime.drainEvents();
  if (
    !drainedAuthorizationFailureEvents.some(
      (event) => event.kind === 'tool-call-started' && event.toolCallId === 'call-stream-auth-fail',
    )
  ) {
    throw new Error('authorization failure smoke 缺少 tool-call-started 事件。');
  }
  if (
    !drainedAuthorizationFailureEvents.some(
      (event) =>
        event.kind === 'tool-execution-finished' &&
        event.execution.toolCallId === 'call-stream-auth-fail' &&
        event.execution.failed &&
        event.execution.output.includes('[authorization error]'),
    )
  ) {
    throw new Error('authorization failure smoke 缺少 failed 工具完成事件。');
  }

  const authorizationFailureResult = authorizationFailureRuntime.takeCompletedTurnResult();
  if (
    !authorizationFailureResult ||
    authorizationFailureResult.kind !== 'completed' ||
    authorizationFailureResult.assistantText !== 'AUTHORIZATION_FAILURE_OK'
  ) {
    throw new Error('authorization failure smoke 未完成最终回复。');
  }
  if (
    !authorizationFailureResult.toolExecutions.some(
      (execution) =>
        execution.toolCallId === 'call-stream-auth-fail' &&
        execution.failed &&
        execution.output.includes('[authorization error]'),
    )
  ) {
    throw new Error('authorization failure smoke 未记录失败工具执行。');
  }
  if (
    !authorizationFailureRuntime.history().some(
      (message) =>
        message.role === 'assistant' &&
        message.toolCalls?.some(
          (toolCall) =>
            toolCall.id === 'call-stream-auth-fail' &&
            toolCall.name === 'read_file' &&
            toolCall.argumentsJson === '{"path":"D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs"}',
        ),
    )
  ) {
    throw new Error('authorization failure smoke 未把 assistant tool call 父消息写入 llmHistory。');
  }
  if (
    !authorizationFailureRuntime.history().some(
      (message) =>
        message.role === 'tool' &&
        message.toolCallId === 'call-stream-auth-fail' &&
        llmMessageTextContent(message.content).includes('[authorization error]'),
    )
  ) {
    throw new Error('authorization failure smoke 未把失败工具结果写入 llmHistory。');
  }

  if (
    !authorizationFailureRuntime.toArchive([], []).llmHistory.some(
      (message) =>
        message.role === 'assistant' &&
        'toolCalls' in message &&
        Array.isArray(message.toolCalls) &&
        message.toolCalls.some(
          (toolCall) =>
            toolCall.id === 'call-stream-auth-fail' &&
            toolCall.name === 'read_file' &&
            toolCall.argumentsJson === '{"path":"D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs"}',
        ),
    )
  ) {
    throw new Error('authorization failure smoke 未把 assistant tool call 父消息写入 archive。');
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

  const streamingApprovalThenImageExecutor = new StreamingApprovalExecutor();
  let generateImageStarted: number = 0;
  let resolveApprovedImage: ((output: ToolExecutionOutput) => void) | undefined;
  const approvedImageOutput = new Promise<ToolExecutionOutput>((resolve) => {
    resolveApprovedImage = resolve;
  });
  const streamingApprovalThenImageRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalThenGenerateImageTransport(),
    toolExecutor: streamingApprovalThenImageExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    generateImage: async () => {
      generateImageStarted += 1;
      return approvedImageOutput;
    },
    onEvent: (event) => streamingApprovalThenImageEvents.push(event),
  });

  await streamingApprovalThenImageRuntime.startUserTurnStreaming('请审批后继续生成图片');
  await flushMicrotasks(4);
  await streamingApprovalThenImageRuntime.poll();
  if (!streamingApprovalThenImageRuntime.hasPendingApproval()) {
    throw new Error('streaming approval then image smoke 未进入待审批状态。');
  }

  let approvalReturned = false;
  const continueApprovalPromise = streamingApprovalThenImageRuntime
    .continuePendingApproval({ kind: 'allow' })
    .then(() => {
      approvalReturned = true;
    });
  await flushMicrotasks(32);
  if (!approvalReturned) {
    throw new Error('streaming approval then image smoke 不应等待 generate_image 完成后才结束审批恢复。');
  }
  await continueApprovalPromise;
  if (streamingApprovalThenImageRuntime.hasPendingApproval()) {
    throw new Error('streaming approval then image smoke 审批恢复后应立即清空待审批状态。');
  }
  if (!streamingApprovalThenImageRuntime.isBusy()) {
    throw new Error('streaming approval then image smoke 审批恢复后应继续保持 busy。');
  }
  if (generateImageStarted !== 0) {
    throw new Error('streaming approval then image smoke 不应在 continuePendingApproval 内直接启动 generate_image。');
  }

  const drainedApprovalThenImageEvents = streamingApprovalThenImageRuntime.drainEvents();
  if (
    !drainedApprovalThenImageEvents.some(
      (event) => event.kind === 'approval-resolved' && event.toolName === 'create_file',
    )
  ) {
    throw new Error('streaming approval then image smoke 缺少 approval-resolved 事件。');
  }
  if (
    !drainedApprovalThenImageEvents.some(
      (event) =>
        event.kind === 'tool-execution-finished' &&
        event.execution.toolName === 'create_file' &&
        event.execution.output.includes('approved output for create_file'),
    )
  ) {
    throw new Error('streaming approval then image smoke 缺少已审批工具的完成事件。');
  }
  if (
    drainedApprovalThenImageEvents.some(
      (event) => event.kind === 'tool-execution-finished' && event.execution.toolName === 'generate_image',
    )
  ) {
    throw new Error('streaming approval then image smoke 不应在审批恢复事件批次里提前完成 generate_image。');
  }

  let continuationPollReturned = false;
  const continuationPoll = streamingApprovalThenImageRuntime.poll().then(() => {
    continuationPollReturned = true;
  });
  await flushMicrotasks(32);
  if (Number(generateImageStarted) !== 1) {
    throw new Error('streaming approval then image smoke 下一拍 poll 应启动 generate_image。');
  }
  if (continuationPollReturned) {
    throw new Error('streaming approval then image smoke generate_image 未完成前 continuation poll 不应提前返回。');
  }

  resolveApprovedImage?.({
    content: createLlmMessageContentFromText('[generated image] approval-follow-up ready'),
    summaryText: '[generated image] approval-follow-up ready',
  });
  await continuationPoll;

  for (let index = 0; index < 12 && streamingApprovalThenImageRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalThenImageRuntime.poll();
  }
  if (streamingApprovalThenImageRuntime.isBusy()) {
    throw new Error('streaming approval then image smoke 未在预期轮次内完成。');
  }

  const streamingApprovalThenImageResult = streamingApprovalThenImageRuntime.takeCompletedTurnResult();
  if (
    !streamingApprovalThenImageResult ||
    streamingApprovalThenImageResult.kind !== 'completed' ||
    streamingApprovalThenImageResult.assistantText !== 'STREAM_APPROVAL_THEN_IMAGE_OK'
  ) {
    throw new Error('streaming approval then image smoke 未完成最终回复。');
  }
  if (streamingApprovalThenImageExecutor.executedCalls !== 1) {
    throw new Error('streaming approval then image smoke 宿主工具执行次数不正确。');
  }
  if (
    !streamingApprovalThenImageResult.toolExecutions.some(
      (execution) =>
        execution.toolName === 'generate_image' &&
        execution.output.includes('[generated image] approval-follow-up ready'),
    )
  ) {
    throw new Error('streaming approval then image smoke 未记录 generate_image 结果。');
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
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-old-streaming', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-old-streaming',
      content: createLlmMessageContentFromText('old tool output\n' + 'x'.repeat(5000)),
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

  return { drainedStreamingEvents, previewEarlyExecutionEvents, drainedAuthorizationFailureEvents, drainedTimeoutEvents, drainedStreamingFailureEvents, drainedStreamingApprovalEvents, drainedStreamingApprovalImageEvents, drainedStreamingGuidanceEvents, drainedStreamingBackgroundEvents, drainedStreamingCompactionEvents, drainedApprovalThenImageEvents };
}

class StreamingApprovalThenGenerateImageTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_THEN_IMAGE_SYNC_FALLBACK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'streaming-approval-then-image-sync-fallback' }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: 'assistant',
                  content: '先审批写文件，再继续生成图片。',
                  tool_calls: [
                    {
                      id: 'call-stream-approval-then-image-file',
                      type: 'function',
                      function: {
                        name: 'create_file',
                        arguments: '{"path":"demo.txt","content":"hello"}',
                      },
                    },
                    {
                      id: 'call-stream-approval-then-image-generate',
                      type: 'function',
                      function: {
                        name: 'generate_image',
                        arguments: '{"prompt":"approval follow-up poster","size":"1024x1024"}',
                      },
                    },
                  ],
                },
              ],
              steps: state.steps + 1,
            },
            step: {
              kind: 'tool-calls',
              calls: [
                {
                  id: 'call-stream-approval-then-image-file',
                  name: 'create_file',
                  argumentsJson: '{"path":"demo.txt","content":"hello"}',
                },
                {
                  id: 'call-stream-approval-then-image-generate',
                  name: 'generate_image',
                  argumentsJson: '{"prompt":"approval follow-up poster","size":"1024x1024"}',
                },
              ],
            },
            requestTrace: [{ mode: 'streaming-approval-then-image-round-1' }],
          },
        }),
      };
    }

    const hasApprovedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-stream-approval-then-image-file' &&
        typeof message.content === 'string' &&
        message.content.includes('approved output for create_file'),
    );
    if (!hasApprovedToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming approval then image resume 未写回审批工具结果。',
          requestTrace: [{ mode: 'streaming-approval-then-image-round-2-missing-approved-tool' }],
        }),
      };
    }

    const hasImageToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-stream-approval-then-image-generate' &&
        typeof message.content === 'string' &&
        message.content.includes('[generated image] approval-follow-up ready'),
    );
    if (!hasImageToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'streaming approval then image resume 未写回 generate_image 结果。',
          requestTrace: [{ mode: 'streaming-approval-then-image-round-2-missing-image-tool' }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: 'assistant-chunk', text: 'STREAM_APPROVAL_THEN_IMAGE_' },
        { kind: 'assistant-chunk', text: 'OK' },
        { kind: 'done' },
      ]),
      completion: Promise.resolve({
        kind: 'success',
        result: {
          state: {
            messages: [...state.messages, { role: 'assistant', content: 'STREAM_APPROVAL_THEN_IMAGE_OK' }],
            steps: state.steps + 1,
          },
          step: { kind: 'final-response-ready' },
          requestTrace: [{ mode: 'streaming-approval-then-image-round-2' }],
        },
      }),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class PreviewEarlyExecutionTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound: ((completion: ToolAgentRoundCompletion<ScriptedState>) => void) | undefined;
  toolCallRoundResolved = false;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('preview early execution smoke 应走 streaming transport。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: 'streaming-tool-preview',
            toolCallId: 'call-preview-read',
            toolName: 'read_file',
            argumentsJson: '{"path":"preview.txt"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'PREVIEW_EARLY_' },
          { kind: 'assistant-chunk', text: 'OK' },
          { kind: 'done' },
        ]),
        completion: Promise.resolve(this.buildFinalRound(state)),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: 'failure',
        error: 'preview early execution smoke 不应进入额外轮次。',
        requestTrace: [{ mode: 'preview-early-extra-round' }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error('preview early execution smoke 未准备好正式 tool-calls completion。');
    }
    this.toolCallRoundResolved = true;
    this.resolveFirstRound(this.buildToolCallRound(this.firstRoundState));
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }

  private buildToolCallRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [
            ...state.messages,
            {
              role: 'assistant',
              content: '准备读取文件。',
              tool_calls: [
                {
                  id: 'call-preview-read',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"preview.txt"}',
                  },
                },
              ],
            },
          ],
          steps: state.steps + 1,
        },
        step: {
          kind: 'tool-calls',
          calls: [
            {
              id: 'call-preview-read',
              name: 'read_file',
              argumentsJson: '{"path":"preview.txt"}',
            },
          ],
        },
        requestTrace: [{ mode: 'preview-early-tool-round' }],
      },
    };
  }

  private buildFinalRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'PREVIEW_EARLY_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'preview-early-final-round' }],
      },
    };
  }
}

class CountingReadFileExecutor extends HostExecutor {
  executedCalls: number = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return super.execute(request);
  }
}

class AuthorizationFailureTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        kind: 'success',
        result: {
          state: {
            messages: [
              ...state.messages,
              {
                role: 'assistant',
                content: '我先读一下这个文件。',
                tool_calls: [
                  {
                    id: 'call-stream-auth-fail',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs"}',
                    },
                  },
                ],
              },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: 'tool-calls',
            calls: [
              {
                id: 'call-stream-auth-fail',
                name: 'read_file',
                argumentsJson: '{"path":"D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs"}',
              },
            ],
          },
          requestTrace: [{ mode: 'authorization-failure-round-1' }],
        },
      };
    }

    const hasAuthorizationFailure = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === 'tool' &&
        message.tool_call_id === 'call-stream-auth-fail' &&
        typeof message.content === 'string' &&
        message.content.includes('[authorization error]'),
    );
    if (!hasAuthorizationFailure) {
      return {
        kind: 'failure',
        error: 'authorization failure 状态未写回。',
        requestTrace: [{ mode: 'authorization-failure-round-2-missing-tool' }],
      };
    }

    return {
      kind: 'success',
      result: {
        state: {
          messages: [...state.messages, { role: 'assistant', content: 'AUTHORIZATION_FAILURE_OK' }],
          steps: state.steps + 1,
        },
        step: { kind: 'final-response-ready' },
        requestTrace: [{ mode: 'authorization-failure-round-2' }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class AuthorizationFailureExecutor extends HostExecutor {
  override async authorize(request: ScriptedToolRequest): Promise<{ kind: 'allowed' }> {
    if (
      request.name === 'read_file' &&
      request.argumentsJson.includes('D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs')
    ) {
      throw new Error('path not found: D:\\SpiritAgent\\apps\\cli\\src\\tool_runtime.rs');
    }

    return { kind: 'allowed' };
  }
}

class PreviewBackgroundDeferredTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound: ((completion: ToolAgentRoundCompletion<ScriptedState>) => void) | undefined;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('preview background smoke 应走 streaming transport。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: 'streaming-tool-preview',
            toolCallId: 'call-preview-background',
            toolName: 'grep',
            argumentsJson: '{"query":"runtime parity"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'PREVIEW_BACKGROUND_' },
          { kind: 'assistant-chunk', text: 'OK' },
          { kind: 'done' },
        ]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [...state.messages, { role: 'assistant', content: 'PREVIEW_BACKGROUND_OK' }],
              steps: state.steps + 1,
            },
            step: { kind: 'final-response-ready' },
            requestTrace: [{ mode: 'preview-background-final-round' }],
          },
        }),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: 'failure',
        error: 'preview background smoke 不应进入额外轮次。',
        requestTrace: [{ mode: 'preview-background-extra-round' }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error('preview background smoke 未准备好正式 tool-calls completion。');
    }
    this.resolveFirstRound({
      kind: 'success',
      result: {
        state: {
          messages: [
            ...this.firstRoundState.messages,
            {
              role: 'assistant',
              content: '准备后台搜索。',
              tool_calls: [
                {
                  id: 'call-preview-background',
                  type: 'function',
                  function: {
                    name: 'grep',
                    arguments: '{"query":"runtime parity"}',
                  },
                },
              ],
            },
          ],
          steps: this.firstRoundState.steps + 1,
        },
        step: {
          kind: 'tool-calls',
          calls: [
            {
              id: 'call-preview-background',
              name: 'grep',
              argumentsJson: '{"query":"runtime parity"}',
            },
          ],
        },
        requestTrace: [{ mode: 'preview-background-tool-round' }],
      },
    });
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class CountingBackgroundExecutor extends BackgroundExecutor {
  executedCalls: number = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return super.execute(request);
  }
}

class PreviewSubagentDeferredTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound: ((completion: ToolAgentRoundCompletion<ScriptedState>) => void) | undefined;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error('preview subagent smoke 应走 streaming transport。');
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: 'streaming-tool-preview',
            toolCallId: 'call-preview-subagent',
            toolName: 'run_subagent',
            argumentsJson: '{"task":"输出：好的，我是 SubAgent，哈哈哈"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      const delegatedPromptPresent = state.messages.some(
        (message) =>
          isJsonObject(message)
          && message.role === 'user'
          && typeof message.content === 'string'
          && message.content.includes('You are already inside the delegated child session.'),
      );
      if (!delegatedPromptPresent) {
        return {
          eventStream: streamFromEvents([]),
          completion: Promise.resolve({
            kind: 'failure',
            error: 'preview subagent child round 未收到委托后的 user turn。',
            requestTrace: [{ mode: 'preview-subagent-child-round-missing-user-turn' }],
          }),
        };
      }

      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [...state.messages, { role: 'assistant', content: '好的，我是 SubAgent，哈哈哈' }],
              steps: state.steps + 1,
            },
            step: { kind: 'final-response-ready' },
            requestTrace: [{ mode: 'preview-subagent-child-round' }],
          },
        }),
      };
    }

    const toolResultMessage = state.messages.find(
      (message) =>
        isJsonObject(message)
        && message.role === 'tool'
        && message.tool_call_id === 'call-preview-subagent'
        && typeof message.content === 'string',
    );
    if (
      !toolResultMessage
      || !isJsonObject(toolResultMessage)
      || typeof toolResultMessage.content !== 'string'
      || !toolResultMessage.content.includes('好的，我是 SubAgent，哈哈哈')
    ) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: 'failure',
          error: 'preview subagent parent round 未收到子代理结果。',
          requestTrace: [{ mode: 'preview-subagent-parent-round-missing-tool-result' }],
        }),
      };
    }

    if (this.rounds === 3) {
      return {
        eventStream: streamFromEvents([
          { kind: 'assistant-chunk', text: 'PREVIEW_SUBAGENT_' },
          { kind: 'assistant-chunk', text: 'OK' },
          { kind: 'done' },
        ]),
        completion: Promise.resolve({
          kind: 'success',
          result: {
            state: {
              messages: [...state.messages, { role: 'assistant', content: 'PREVIEW_SUBAGENT_OK' }],
              steps: state.steps + 1,
            },
            step: { kind: 'final-response-ready' },
            requestTrace: [{ mode: 'preview-subagent-parent-round-2' }],
          },
        }),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: 'failure',
        error: 'preview subagent smoke 不应进入额外轮次。',
        requestTrace: [{ mode: 'preview-subagent-extra-round' }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error('preview subagent smoke 未准备好正式 tool-calls completion。');
    }
    this.resolveFirstRound({
      kind: 'success',
      result: {
        state: {
          messages: [
            ...this.firstRoundState.messages,
            {
              role: 'assistant',
              content: '准备委托子代理。',
              tool_calls: [
                {
                  id: 'call-preview-subagent',
                  type: 'function',
                  function: {
                    name: 'run_subagent',
                    arguments: '{"task":"输出：好的，我是 SubAgent，哈哈哈"}',
                  },
                },
              ],
            },
          ],
          steps: this.firstRoundState.steps + 1,
        },
        step: {
          kind: 'tool-calls',
          calls: [
            {
              id: 'call-preview-subagent',
              name: 'run_subagent',
              argumentsJson: '{"task":"输出：好的，我是 SubAgent，哈哈哈"}',
            },
          ],
        },
        requestTrace: [{ mode: 'preview-subagent-parent-round-1' }],
      },
    });
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes('context');
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}
