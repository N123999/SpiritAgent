import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../openai/transport.js';
import { AgentRuntime } from '../runtime.js';

import {
  createOpenAiSmokeConfig,
  createOpenAiSmokeTransport,
  DemoToolExecutor,
  printSmokeSection,
} from './openai-shared.js';

async function main(): Promise<void> {
  const runtime = new AgentRuntime({
    config: createOpenAiSmokeConfig(),
    llmTransport: createOpenAiSmokeTransport(),
    toolExecutor: new DemoToolExecutor(),
    createToolAgentState: startOpenAiToolAgentState,
    appendToolResultMessage: appendOpenAiToolResultMessage,
    extractAssistantText: extractLastOpenAiAssistantText,
  });

  const result = await runtime.submitUserTurn(
    'First call demo_lookup exactly once with query "Spirit Agent migration". After the tool result is returned, answer with exactly "RUNTIME_OK" and nothing else.',
  );

  printSmokeSection('runtime smoke result', result);

  if (result.kind !== 'completed') {
    throw new Error(`runtime smoke 未完成闭环，当前结果: ${result.kind}`);
  }

  if (!result.assistantText.trim()) {
    throw new Error('runtime smoke 未拿到最终 assistant 文本。');
  }

  printSmokeSection('runtime history snapshot', runtime.history());
  printSmokeSection('runtime request trace count', runtime.requestTrace().length);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai runtime smoke failed: ${message}`);
  process.exitCode = 1;
});