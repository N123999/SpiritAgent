import {
  appendOpenAiToolResultMessage,
  startOpenAiToolAgentState,
} from '../openai/transport.js';

import {
  createOpenAiSmokeConfig,
  createOpenAiSmokeTransport,
  demoLookupToolDefinition,
  printSmokeSection,
} from './openai-shared.js';

async function main(): Promise<void> {
  const transport = createOpenAiSmokeTransport();
  const config = createOpenAiSmokeConfig();
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    'First call demo_lookup exactly once with query "Spirit Agent migration". After the tool result is returned, answer with exactly "ROUNDTRIP_OK" and nothing else.',
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection('roundtrip step 1', firstRound);

  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    throw new Error('roundtrip smoke step 1 未返回 tool-calls。');
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    throw new Error('roundtrip smoke step 1 没有任何 tool call。');
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"Spirit Agent migration","result":"transport bridge ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  printSmokeSection('roundtrip step 2', secondRound);

  if (secondRound.kind !== 'success') {
    throw new Error(`roundtrip smoke step 2 失败: ${secondRound.error}`);
  }

  if (secondRound.result.step.kind !== 'final-response-ready') {
    throw new Error('roundtrip smoke step 2 未进入 final-response-ready。');
  }

  const lastMessage = secondRound.result.state.messages.at(-1);
  const content =
    lastMessage && typeof lastMessage === 'object' && lastMessage !== null && 'content' in lastMessage
      ? lastMessage.content
      : undefined;

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('roundtrip smoke step 2 没有拿到最终 assistant 文本。');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai roundtrip smoke failed: ${message}`);
  process.exitCode = 1;
});