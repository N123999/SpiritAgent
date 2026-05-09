import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import {
  appendOpenAiToolResultMessage,
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';

async function main(): Promise<void> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestCount += 1;
    response.writeHead(200, {
      'content-type': 'application/json',
    });

    if (requestCount === 1) {
      response.end(
        JSON.stringify({
          id: 'chatcmpl-ai-sdk-tool-call',
          object: 'chat.completion',
          created: 0,
          model: 'test-openai-compatible',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_ai_sdk_1',
                    type: 'function',
                    function: {
                      name: 'demo_lookup',
                      arguments: '{"query":"Spirit Agent migration"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      );
      return;
    }

    response.end(
      JSON.stringify({
        id: 'chatcmpl-ai-sdk-final',
        object: 'chat.completion',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'AI_SDK_OK',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
    );
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const transport = new AiSdkOpenAiCompatibleTransport();
  const config = {
    apiKey: 'test-key',
    model: 'test-openai-compatible',
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
  };
  const tools = demoLookupToolDefinition();

  const initialState = startOpenAiToolAgentState(
    [],
    'First call demo_lookup exactly once with query "Spirit Agent migration". After the tool result is returned, answer with exactly "AI_SDK_OK" and nothing else.',
    process.cwd(),
    [],
    [],
    [],
    config.model,
  );

  const firstRound = await transport.startToolAgentRound(config, initialState, tools);
  printSmokeSection('ai-sdk openai smoke step 1', firstRound);

  if (firstRound.kind !== 'success' || firstRound.result.step.kind !== 'tool-calls') {
    throw new Error('ai-sdk openai smoke step 1 未进入 tool-calls。');
  }

  const firstCall = firstRound.result.step.calls.at(0);
  if (!firstCall) {
    throw new Error('ai-sdk openai smoke step 1 没有任何 tool call。');
  }

  const resumedState = appendOpenAiToolResultMessage(
    firstRound.result.state,
    firstCall.id,
    '{"query":"Spirit Agent migration","result":"transport bridge ok"}',
  );

  const secondRound = await transport.startToolAgentRound(config, resumedState, tools);
  printSmokeSection('ai-sdk openai smoke step 2', secondRound);
  server.close();

  if (secondRound.kind !== 'success' || secondRound.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk openai smoke step 2 未进入 final-response-ready。');
  }

  const assistantText = extractLastOpenAiAssistantText(secondRound.result.state)?.trim();
  if (assistantText !== 'AI_SDK_OK') {
    throw new Error(`ai-sdk openai smoke step 2 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`);
  }

  const tracedAssistantMessage = findLastAssistantWithToolCalls(secondRound.result.requestTrace);
  if (!isJsonObject(tracedAssistantMessage) || tracedAssistantMessage.reasoning_content !== '') {
    throw new Error('ai-sdk openai smoke 未在 request trace 的 assistant tool_call message 上保留空 reasoning_content。');
  }
}

function findLastAssistantWithToolCalls(requestTrace: JsonValue[]): JsonValue | undefined {
  const firstTrace = requestTrace[0];
  if (!isJsonObject(firstTrace) || !Array.isArray(firstTrace.messages)) {
    return undefined;
  }

  return [...firstTrace.messages]
    .reverse()
    .find((message) => isJsonObject(message) && message.role === 'assistant' && Array.isArray(message.tool_calls));
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai smoke failed: ${message}`);
  process.exitCode = 1;
});