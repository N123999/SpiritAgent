import { startOpenAiToolAgentState } from '../openai/transport.js';

import {
  createOpenAiSmokeConfig,
  createOpenAiSmokeTransport,
  demoLookupToolDefinition,
  printSmokeSection,
} from './openai-shared.js';

async function main(): Promise<void> {
  const transport = createOpenAiSmokeTransport();
  const config = createOpenAiSmokeConfig();

  const finalState = startOpenAiToolAgentState([], 'Reply with exactly OK.', process.cwd(), [], [], [], config.model);
  const finalRound = await transport.startToolAgentRound(config, finalState, []);

  printSmokeSection('final-response smoke', finalRound);

  const toolDefinition = demoLookupToolDefinition();

  const toolState = startOpenAiToolAgentState(
    [],
    'You must call demo_lookup exactly once with query "Spirit Agent migration". Do not answer directly.',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );
  const toolRound = await transport.startToolAgentRound(config, toolState, toolDefinition);

  printSmokeSection('tool-call smoke', toolRound);

  if (toolRound.kind !== 'success' || toolRound.result.step.kind !== 'tool-calls') {
    throw new Error('tool-call smoke 未进入 tool-calls。');
  }

  const lastMessage = toolRound.result.state.messages.at(-1);
  if (
    !lastMessage ||
    typeof lastMessage !== 'object' ||
    lastMessage === null ||
    !('reasoning_content' in lastMessage) ||
    lastMessage.reasoning_content !== ''
  ) {
    throw new Error('tool-call smoke 未在非流式 assistant tool_call message 上保留空 reasoning_content。');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai smoke failed: ${message}`);
  process.exitCode = 1;
});