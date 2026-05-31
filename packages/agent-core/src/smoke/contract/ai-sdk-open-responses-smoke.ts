import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenResponsesTransport } from '../../open-responses/ai-sdk-transport.js';
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';
import {
  buildOpenResponsesFinalTextBody,
  buildOpenResponsesToolCallBody,
} from './open-responses-mock.js';

async function main(): Promise<void> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/responses')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestCount += 1;
    response.writeHead(200, {
      'content-type': 'application/json',
    });

    if (requestCount === 1) {
      response.end(JSON.stringify(buildOpenResponsesToolCallBody('test-open-responses')));
      return;
    }

    response.end(JSON.stringify(buildOpenResponsesFinalTextBody('test-open-responses', 'OPEN_RESPONSES_OK')));
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
    model: 'test-open-responses',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
    responsesProvider: 'open-responses-compatible' as const,
    llmVendor: 'custom' as const,
  };
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    'First call demo_lookup exactly once with query "Spirit Agent migration". After the tool result is returned, answer with exactly "OPEN_RESPONSES_OK" and nothing else.',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection('ai-sdk open-responses smoke step 1', firstRound);

  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    throw new Error('ai-sdk open-responses smoke step 1 未进入 tool-calls。');
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    throw new Error('ai-sdk open-responses smoke step 1 没有任何 tool call。');
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"Spirit Agent migration","result":"transport bridge ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  printSmokeSection('ai-sdk open-responses smoke step 2', secondRound);
  server.close();

  if (secondRound.kind !== 'success' || secondRound.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk open-responses smoke step 2 未进入 final-response-ready。');
  }

  const assistantText = extractLastOpenAiAssistantText(secondRound.result.state)?.trim();
  if (assistantText !== 'OPEN_RESPONSES_OK') {
    throw new Error(
      `ai-sdk open-responses smoke step 2 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`,
    );
  }

  const traceKind = secondRound.result.requestTrace[0];
  if (!isJsonObject(traceKind) || traceKind.kind !== 'open_responses_sdk_responses') {
    throw new Error('ai-sdk open-responses smoke 未写入 open_responses_sdk_responses trace。');
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk open-responses smoke failed: ${message}`);
  process.exitCode = 1;
});
