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

  const finalState = startOpenAiToolAgentState([], 'Reply with exactly OK.');
  const finalRound = await transport.startToolAgentRound(config, finalState, []);

  printSmokeSection('final-response smoke', finalRound);

  const toolDefinition = demoLookupToolDefinition();

  const toolState = startOpenAiToolAgentState(
    [],
    'You must call demo_lookup exactly once with query "Spirit Agent migration". Do not answer directly.',
  );
  const toolRound = await transport.startToolAgentRound(config, toolState, toolDefinition);

  printSmokeSection('tool-call smoke', toolRound);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai smoke failed: ${message}`);
  process.exitCode = 1;
});