import type { LlmMessage } from '../ports.js';

import {
  buildCompactSmokeHistory,
  createOpenAiSmokeConfig,
  createOpenAiSmokeTransport,
  printSmokeSection,
} from './openai-shared.js';

async function main(): Promise<void> {
  const transport = createOpenAiSmokeTransport();
  const config = createOpenAiSmokeConfig();
  const history: LlmMessage[] = buildCompactSmokeHistory();
  const progressEvents: string[] = [];

  const result = await transport.compactHistoryManual(config, history, (message) => {
    progressEvents.push(message);
    console.log(`[compact-progress] ${message}`);
  });

  const summary = transport.compactSummaryText(history);

  printSmokeSection('compact smoke result', {
    result,
    progressEvents,
    compactedHistory: history,
    summary,
  });

  if (!summary || !summary.trim()) {
    throw new Error('compact smoke 未生成可读摘要。');
  }

  if (history.length !== 1) {
    throw new Error(`compact smoke 期望 history.length === 1，实际为 ${history.length}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`openai compact smoke failed: ${message}`);
  process.exitCode = 1;
});