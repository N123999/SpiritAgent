import { COMPACT_PROGRESS_TEXT } from '../../../../llm-context-block.js';
import {
  AgentRuntime,
  CompactExecutor,
  FinalTextTransport,
  HostExecutor,
  PollingManualBackgroundExecutor,
  ProgressManualCompactionTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  truncateScriptedHistoryForCompaction,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedToolRequest,
} from './harness.js';

export async function runManualToolsCase(): Promise<RuntimeParityCaseResult> {
  const manualBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const manualCompactionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const hostRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('MANUAL_GUIDANCE_OK'),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const manualAllowed = await hostRuntime.executeManualToolCommand('/tool read demo.txt');
  if (manualAllowed.kind !== 'completed' || manualAllowed.output !== 'manual output for read_file') {
    throw new Error('manual tool allowed smoke 未完成。');
  }

  const manualApproval = await hostRuntime.executeManualToolCommand('/tool delete demo.txt');
  if (manualApproval.kind !== 'requires-approval') {
    throw new Error('manual tool approval smoke 未进入审批。');
  }

  const manualGuidance = await hostRuntime.resumePendingManualToolApproval({
    kind: 'guidance',
    userMessage: '别删文件，先给总结',
  });
  if (manualGuidance.kind !== 'submitted-user-turn') {
    throw new Error('manual guidance smoke 未转交为 user turn。');
  }
  if (
    manualGuidance.result.kind !== 'completed' ||
    manualGuidance.result.assistantText !== 'MANUAL_GUIDANCE_OK'
  ) {
    throw new Error('manual guidance smoke 未跑通最终回复。');
  }

  const manualBackgroundExecutor = new PollingManualBackgroundExecutor();
  const manualBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('UNUSED_MANUAL_BACKGROUND'),
    toolExecutor: manualBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => manualBackgroundEvents.push(event),
  });

  const manualBackgroundStarted = await manualBackgroundRuntime.startManualToolCommand(
    '/tool search runtime parity',
  );
  if (
    manualBackgroundStarted.kind !== 'started-background' ||
    manualBackgroundStarted.statusText !== '搜索中: runtime parity'
  ) {
    throw new Error('manual background smoke 未进入 started-background。');
  }
  const manualBackgroundAux = manualBackgroundRuntime.pendingAuxState();
  if (
    !manualBackgroundAux ||
    manualBackgroundAux.kind !== 'thinking' ||
    manualBackgroundAux.detailText !== '搜索中: runtime parity'
  ) {
    throw new Error('manual background smoke 未暴露 thinking aux 状态。');
  }
  if (manualBackgroundRuntime.takeCompletedManualToolCommandResult()) {
    throw new Error('manual background smoke 在后台工具完成前不应产出结果。');
  }

  manualBackgroundExecutor.finish('manual output for grep');
  let manualBackgroundCompleted;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await manualBackgroundRuntime.poll();
    manualBackgroundCompleted = manualBackgroundRuntime.takeCompletedManualToolCommandResult();
    if (manualBackgroundCompleted) {
      break;
    }
  }
  if (
    !manualBackgroundCompleted ||
    manualBackgroundCompleted.output !== 'manual output for grep' ||
    !manualBackgroundCompleted.backgroundExecution ||
    manualBackgroundCompleted.failed
  ) {
    throw new Error('manual background smoke 未得到后台工具完成结果。');
  }
  if (
    !manualBackgroundEvents.some(
      (event) => event.kind === 'background-tool-status' && event.phase === 'started',
    ) ||
    !manualBackgroundEvents.some(
      (event) => event.kind === 'background-tool-status' && event.phase === 'finished',
    )
  ) {
    throw new Error('manual background smoke 缺少完整后台状态事件。');
  }

  const manualCompactionTransport = new ProgressManualCompactionTransport();
  const manualCompactionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: manualCompactionTransport,
    toolExecutor: new CompactExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
    onEvent: (event) => manualCompactionEvents.push(event),
  }, [
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-old-manual', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-old-manual',
      content: createLlmMessageContentFromText('old tool output\n' + 'x'.repeat(5000)),
    },
    {
      role: 'assistant',
      content: createLlmMessageContentFromText('旧回答。'),
    },
    {
      role: 'user',
      content: createLlmMessageContentFromText('请帮我压缩上下文。'),
    },
  ]);

  await manualCompactionRuntime.startManualHistoryCompaction();
  await flushMicrotasks(4);
  await manualCompactionRuntime.poll();
  const manualCompactionAux = manualCompactionRuntime.pendingAuxState();
  if (!manualCompactionAux || manualCompactionAux.kind !== 'compressing') {
    throw new Error('manual compaction smoke 未暴露 compressing aux 状态。');
  }
  if (manualCompactionRuntime.takeCompletedManualHistoryCompactionResult()) {
    throw new Error('manual compaction smoke 在压缩完成前不应产出结果。');
  }

  manualCompactionTransport.finishCompaction();
  let manualCompactionCompleted;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await manualCompactionRuntime.poll();
    manualCompactionCompleted = manualCompactionRuntime.takeCompletedManualHistoryCompactionResult();
    if (manualCompactionCompleted) {
      break;
    }
  }
  if (
    !manualCompactionCompleted ||
    manualCompactionCompleted.kind !== 'completed' ||
    manualCompactionCompleted.result.droppedMessages <= 0
  ) {
    throw new Error('manual compaction smoke 未得到有效压缩结果。');
  }
  const drainedManualCompactionEvents = manualCompactionRuntime.drainEvents();
  if (!drainedManualCompactionEvents.some((event) => event.kind === 'begin-assistant-response')) {
    throw new Error('manual compaction smoke 缺少 begin event。');
  }
  if (
    !drainedManualCompactionEvents.some(
      (event) =>
        event.kind === 'update-pending-assistant-compaction' &&
        event.text.includes(COMPACT_PROGRESS_TEXT),
    )
  ) {
    throw new Error('manual compaction smoke 缺少 progress update 事件。');
  }
  if (
    !drainedManualCompactionEvents.some(
      (event) =>
        event.kind === 'replace-pending-assistant' && event.text.includes('压缩完成：上下文消息'),
    )
  ) {
    throw new Error('manual compaction smoke 缺少完成提示事件。');
  }
  if (!drainedManualCompactionEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('manual compaction smoke 缺少 completed event。');
  }

  return { manualGuidance, manualBackgroundCompleted, manualCompactionCompleted, drainedManualCompactionEvents };
}
