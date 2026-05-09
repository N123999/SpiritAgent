import {
  AgentRuntime,
  BackgroundExecutor,
  BackgroundTransport,
  PollingBackgroundExecutor,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type RuntimeTurnResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from './harness.js';

export async function runBackgroundCase(): Promise<RuntimeParityCaseResult> {
  const backgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const pollingBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const backgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new BackgroundTransport(),
    toolExecutor: new BackgroundExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => backgroundEvents.push(event),
  });

  const backgroundResult = await backgroundRuntime.submitUserTurn('请后台搜索 runtime parity。');
  if (backgroundResult.kind !== 'completed' || backgroundResult.assistantText !== 'BACKGROUND_OK') {
    throw new Error('background execution smoke 未完成闭环。');
  }

  const startedBackground = backgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'started',
  );
  const finishedBackground = backgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'finished',
  );
  if (!startedBackground || !finishedBackground) {
    throw new Error('background execution smoke 未收到开始/结束事件。');
  }
  if (startedBackground.statusText !== '搜索中: runtime parity') {
    throw new Error('background execution smoke 状态文本不正确。');
  }
  if (backgroundRuntime.backgroundToolStatus() !== undefined) {
    throw new Error('background execution smoke 结束后应清空 pending background status。');
  }

  const pollingBackgroundExecutor = new PollingBackgroundExecutor();
  const pollingBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new BackgroundTransport(),
    toolExecutor: pollingBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => pollingBackgroundEvents.push(event),
  });

  await pollingBackgroundRuntime.startUserTurn('请后台搜索 runtime parity。');
  await flushMicrotasks(4);
  await pollingBackgroundRuntime.poll();
  if (!pollingBackgroundRuntime.isBusy()) {
    throw new Error('polling background smoke 应在后台工具执行期间保持 busy。');
  }
  if (pollingBackgroundRuntime.backgroundToolStatus() !== '搜索中: runtime parity') {
    throw new Error('polling background smoke 未暴露后台工具状态。');
  }
  const backgroundAux = pollingBackgroundRuntime.pendingAuxState();
  if (!backgroundAux || backgroundAux.kind !== 'thinking' || backgroundAux.detailText !== '搜索中: runtime parity') {
    throw new Error('polling background smoke 未暴露 thinking aux 状态。');
  }
  pollingBackgroundRuntime.tickThinkingSpinner();
  const backgroundAuxAfterTick = pollingBackgroundRuntime.pendingAuxState();
  if (!backgroundAuxAfterTick || backgroundAuxAfterTick.statusText === backgroundAux.statusText) {
    throw new Error('polling background smoke spinner 未前进。');
  }
  if (pollingBackgroundRuntime.takeCompletedTurnResult()) {
    throw new Error('polling background smoke 在后台工具完成前不应产出结果。');
  }

  pollingBackgroundExecutor.finish('background result for {"query":"runtime parity"}');
  let pollingBackgroundResult: RuntimeTurnResult<ScriptedState, ScriptedToolRequest, string> | undefined;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await pollingBackgroundRuntime.poll();
    pollingBackgroundResult = pollingBackgroundRuntime.takeCompletedTurnResult();
    if (pollingBackgroundResult) {
      break;
    }
  }
  if (
    !pollingBackgroundResult ||
    pollingBackgroundResult.kind !== 'completed' ||
    pollingBackgroundResult.assistantText !== 'BACKGROUND_OK'
  ) {
    throw new Error('polling background smoke 未得到最终完成结果。');
  }
  const pollingStartedBackground = pollingBackgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'started',
  );
  const pollingFinishedBackground = pollingBackgroundEvents.find(
    (
      event,
    ): event is Extract<RuntimeEvent<ScriptedToolRequest>, { kind: 'background-tool-status' }> =>
      event.kind === 'background-tool-status' && event.phase === 'finished',
  );
  if (!pollingStartedBackground || !pollingFinishedBackground) {
    throw new Error('polling background smoke 未收到完整的后台状态事件。');
  }

  return { backgroundResult, pollingBackgroundResult };
}
