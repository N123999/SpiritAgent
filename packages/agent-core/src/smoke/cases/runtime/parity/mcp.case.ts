import {
  AgentRuntime,
  FinalTextTransport,
  HostExecutor,
  StreamingFinalTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  isJsonObject,
  llmMessageTextContent,
  type RuntimeParityCaseResult,
  userMessageContentMatchesInput,
} from './harness.js';

export async function runMcpCase(): Promise<RuntimeParityCaseResult> {
  const promptRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('PROMPT_OK', (state) => {
      if (!state.messages.some((message) => isJsonObject(message) && message.content === 'prompt-system:analysis')) {
        throw new Error('prompt system message 未注入 state。');
      }
      if (!state.messages.some((message) => isJsonObject(message) && message.content === 'prompt-user-message')) {
        throw new Error('prompt user message 未注入 state。');
      }
      if (
        !state.messages.some(
          (message) =>
            isJsonObject(message) &&
            typeof message.content === 'string' &&
            userMessageContentMatchesInput(message.content, '补充说明'),
        )
      ) {
        throw new Error('prompt extra user message 未注入 state。');
      }
    }),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const promptApplied = await promptRuntime.applyMcpPrompt('demo', 'analysis', undefined, '补充说明');
  if (promptApplied.result.kind !== 'completed' || promptApplied.result.assistantText !== 'PROMPT_OK') {
    throw new Error('applyMcpPrompt smoke 未完成闭环。');
  }
  if (!promptApplied.notice.includes('已应用 MCP prompt: demo / analysis')) {
    throw new Error('applyMcpPrompt smoke notice 不正确。');
  }

  const streamingPromptRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFinalTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const startedPrompt = await streamingPromptRuntime.startApplyMcpPrompt(
    'demo',
    'analysis',
    undefined,
    '帮我看看这个工具有什么用',
  );
  if (!startedPrompt.includes('已应用 MCP prompt: demo / analysis')) {
    throw new Error('startApplyMcpPrompt smoke notice 不正确。');
  }
  for (let index = 0; index < 24 && streamingPromptRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingPromptRuntime.poll();
  }
  if (streamingPromptRuntime.isBusy()) {
    throw new Error('streaming prompt smoke 未在预期轮次内完成。');
  }
  const drainedStreamingPromptEvents = streamingPromptRuntime.drainEvents();
  if (
    drainedStreamingPromptEvents.filter((event) => event.kind === 'begin-assistant-response').length !== 1
  ) {
    throw new Error('streaming prompt smoke begin event 数量不正确。');
  }
  if (
    drainedStreamingPromptEvents.filter((event) => event.kind === 'assistant-chunk').length < 2
  ) {
    throw new Error('streaming prompt smoke 缺少 assistant chunk 事件。');
  }
  if (!drainedStreamingPromptEvents.some((event) => event.kind === 'assistant-response-completed')) {
    throw new Error('streaming prompt smoke 缺少 completed event。');
  }
  if (
    !streamingPromptRuntime
      .history()
      .some(
        (message) =>
          message.role === 'user' &&
          userMessageContentMatchesInput(llmMessageTextContent(message.content), '帮我看看这个工具有什么用'),
      )
  ) {
    throw new Error('streaming prompt smoke 未保留附加用户消息。');
  }

  const resourceRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('RESOURCE_OK', (state) => {
      if (
        !state.messages.some(
          (message) =>
            isJsonObject(message) &&
            typeof message.content === 'string' &&
            message.content.startsWith('[MCP_RESOURCE]'),
        )
      ) {
        throw new Error('MCP resource context 未注入 state。');
      }
    }),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const resourceLabel = await resourceRuntime.attachMcpResource('demo', 'mcp://demo/doc');
  if (resourceLabel !== 'demo -> mcp://demo/doc') {
    throw new Error('attachMcpResource smoke label 不正确。');
  }
  const resourceResult = await resourceRuntime.submitUserTurn('结合资源回答');
  if (resourceResult.kind !== 'completed' || resourceResult.assistantText !== 'RESOURCE_OK') {
    throw new Error('attachMcpResource smoke 未完成闭环。');
  }
  if (resourceRuntime.pendingMcpResources().length !== 0) {
    throw new Error('attachMcpResource smoke 提交后应清空 pending resources。');
  }

  const archive = resourceRuntime.toArchive(
    [{ role: 'user', content: 'u' }],
    [],
  );
  const restoredRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport('RESTORED_OK'),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });
  restoredRuntime.replaceFromArchive(archive);
  if (restoredRuntime.history().length !== archive.llmHistory.length) {
    throw new Error('replaceFromArchive smoke 未恢复 llmHistory。');
  }

  return { promptApplied, drainedStreamingPromptEvents, resourceResult, archive };
}
