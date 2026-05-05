import {
  createAiSdkOpenAiDemoRuntime,
  printSmokeSection,
} from './ai-sdk-openai-shared.js';

async function main(): Promise<void> {
  const runtime = createAiSdkOpenAiDemoRuntime();

  const result = await runtime.submitUserTurn(
    'First call demo_lookup exactly once with query "Spirit Agent migration". After the tool result is returned, answer with exactly "RUNTIME_OK" and nothing else.',
  );

  printSmokeSection('ai-sdk openai runtime smoke result', result);

  if (result.kind !== 'completed') {
    throw new Error(`ai-sdk openai runtime smoke 未完成闭环，当前结果: ${result.kind}`);
  }

  if (!result.assistantText.trim()) {
    throw new Error('ai-sdk openai runtime smoke 未拿到最终 assistant 文本。');
  }

  printSmokeSection('ai-sdk openai runtime history snapshot', runtime.history());
  printSmokeSection('ai-sdk openai runtime request trace count', runtime.requestTrace().length);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai runtime smoke failed: ${message}`);
  process.exitCode = 1;
});