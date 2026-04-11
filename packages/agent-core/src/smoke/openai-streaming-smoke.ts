import type { JsonValue } from '../ports.js';

import {
  createOpenAiDemoRuntime,
  pollRuntimeUntilIdle,
  printSmokeSection,
} from './openai-shared.js';

async function main(): Promise<void> {
  const events: JsonValue[] = [];
  const runtime = createOpenAiDemoRuntime({
    onEvent: (event) => events.push(event as unknown as JsonValue),
  });

  await runtime.startUserTurnStreaming(
    'First call demo_lookup exactly once with query "Spirit Agent streaming". After the tool result is returned, answer with exactly "STREAM_RUNTIME_OK" and nothing else.',
  );

  const completed = await pollRuntimeUntilIdle(runtime);

  if (!completed) {
    printSmokeSection('streaming runtime smoke timeout snapshot', {
      pendingUserTurn: runtime.pendingUserTurn(),
      auxState: runtime.pendingAuxState(),
      historyLength: runtime.history().length,
      requestTraceLength: runtime.requestTrace().length,
      drainedEvents: runtime.drainEvents(),
    });
    throw new Error('openai streaming smoke 未在预期轮次内完成。');
  }

  const history = runtime.history();
  const lastAssistant = [...history].reverse().find((message) => message.role === 'assistant');
  const requestTrace = runtime.requestTrace();

  printSmokeSection('streaming runtime smoke events', events);
  printSmokeSection('streaming runtime smoke history snapshot', history);
  printSmokeSection('streaming runtime smoke request trace', requestTrace);

  if (!lastAssistant || lastAssistant.content.trim() !== 'STREAM_RUNTIME_OK') {
    throw new Error('openai streaming smoke 未拿到预期最终 assistant 文本。');
  }

  if (
    requestTrace.length < 2 ||
    !requestTrace.every(
      (entry) => isJsonObject(entry) && entry.kind === 'openai_sdk_chat_completions' && entry.stream === true,
    )
  ) {
    throw new Error('openai streaming smoke 未记录真实 stream=true 的 request trace。');
  }

  if (!events.some((event) => isJsonObject(event) && event.kind === 'assistant-chunk')) {
    throw new Error('openai streaming smoke 未收到 assistant-chunk 事件。');
  }

  if (
    !events.some(
      (event) =>
        isJsonObject(event) &&
        event.kind === 'update-pending-assistant-thinking' &&
        typeof event.text === 'string' &&
        event.text.includes('准备调用工具: demo_lookup'),
    )
  ) {
    throw new Error('openai streaming smoke 未收到 Rust 风格的 tool-progress thinking 事件。');
  }

  if (!history.some((message) => message.role === 'system' && message.content.includes('[TOOL_MEMORY]'))) {
    throw new Error('openai streaming smoke 未保留工具记忆。');
  }

  const firstTraceEntry = requestTrace.find(
    (entry) => isJsonObject(entry) && entry.kind === 'openai_sdk_chat_completions',
  );
  const firstTraceMessages = isJsonObject(firstTraceEntry) ? firstTraceEntry.messages : undefined;
  const firstAssistantMessage = Array.isArray(firstTraceMessages)
    ? [...firstTraceMessages]
        .reverse()
        .find((message) => isJsonObject(message) && message.role === 'assistant' && 'tool_calls' in message)
    : undefined;
  if (!isJsonObject(firstAssistantMessage) || firstAssistantMessage.reasoning_content !== '') {
    throw new Error('openai streaming smoke 未在 tool-call assistant message 上保留空 reasoning_content。');
  }

  const streamedToolCalls = Array.isArray(firstAssistantMessage.tool_calls)
    ? firstAssistantMessage.tool_calls
    : [];
  const firstToolCall = streamedToolCalls[0];
  if (!isJsonObject(firstToolCall) || firstToolCall.index !== 0) {
    throw new Error('openai streaming smoke 未在流式 tool_call 上保留 index 字段。');
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai streaming smoke failed: ${message}`);
  process.exitCode = 1;
});