import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenResponsesTransport } from '../../open-responses/ai-sdk-transport.js';
import { startOpenAiToolAgentState } from '../../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';
import { buildOpenResponsesToolCallBody } from './open-responses-mock.js';

/**
 * 验证 @ai-sdk/openai 的 responses 分支（单轮 tool call）。
 * 双轮续聊在 open-responses-compatible smoke 中覆盖；OpenAI 官方 SDK 与 mock 的
 * 多轮 tool result 形态在 live/集成环境再验证。
 */
async function main(): Promise<void> {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/responses')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(buildOpenResponsesToolCallBody('gpt-test-responses')));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const transport = new AiSdkOpenResponsesTransport();
  const config = {
    transportKind: 'open-responses' as const,
    apiKey: 'test-key',
    model: 'gpt-test-responses',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    responsesProvider: 'openai' as const,
    llmVendor: 'openai' as const,
    store: false,
  };
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    'Call demo_lookup exactly once with query "Spirit Agent migration".',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection('ai-sdk openai responses smoke step 1', firstRound);
  server.close();

  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    throw new Error('ai-sdk openai responses smoke step 1 未进入 tool-calls。');
  }

  const traceKind = firstRound.result.requestTrace[0];
  if (!isJsonObject(traceKind) || traceKind.kind !== 'openai_sdk_responses') {
    throw new Error('ai-sdk openai responses smoke 未写入 openai_sdk_responses trace。');
  }

  const assistantMessage = firstRound.result.state.messages.at(-1);
  if (
    !isJsonObject(assistantMessage) ||
    !isJsonObject(assistantMessage.providerState) ||
    !isJsonObject(assistantMessage.providerState.openAiResponses) ||
    typeof assistantMessage.providerState.openAiResponses.responseId !== 'string'
  ) {
    throw new Error('ai-sdk openai responses smoke 未在 providerState 中保留 responseId。');
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai responses smoke failed: ${message}`);
  process.exitCode = 1;
});
