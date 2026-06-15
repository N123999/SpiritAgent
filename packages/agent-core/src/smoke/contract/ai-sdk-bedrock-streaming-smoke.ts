import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkBedrockTransport } from '../../bedrock/ai-sdk-transport.js';
import {
  appendToolResultMessage,
  buildToolAgentMessages,
  extractLastAssistantText,
  isJsonObject,
  startToolAgentState,
} from '../../tool-agent.js';

import { demoLookupToolDefinition, printSmokeSection } from '../shared/index.js';

const BEDROCK_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';
const BEDROCK_TOOL_USE_ID = 'tool_bedrock_1';

function bedrockConverseToolResponse(): JsonValue {
  return {
    metrics: { latencyMs: 1 },
    output: {
      message: {
        role: 'assistant',
        content: [
          {
            toolUse: {
              toolUseId: BEDROCK_TOOL_USE_ID,
              name: 'demo_lookup',
              input: { query: 'Spirit Agent bedrock' },
            },
          },
        ],
      },
    },
    stopReason: 'tool_use',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

function bedrockConverseTextResponse(text: string): JsonValue {
  return {
    metrics: { latencyMs: 1 },
    output: {
      message: {
        role: 'assistant',
        content: [{ text }],
      },
    },
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  };
}

async function main(): Promise<void> {
  let requestCount = 0;
  const requestBodies: JsonValue[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes('/converse')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    requestBodies.push(await readJsonBody(request));
    requestCount += 1;

    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify(
        requestCount === 1
          ? bedrockConverseToolResponse()
          : bedrockConverseTextResponse('AI_SDK_BEDROCK_OK'),
      ),
    );
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
  const transport = new AiSdkBedrockTransport();
  const state = startToolAgentState(
    buildToolAgentMessages({
      historyMessages: [],
      model: BEDROCK_MODEL,
    }),
    'Call demo_lookup exactly once.',
  );

  const firstCompletion = await transport.startToolAgentRound(
    {
      transportKind: 'bedrock',
      apiKey: 'test-key',
      model: BEDROCK_MODEL,
      region: 'us-east-1',
      baseUrl,
    },
    state,
    demoLookupToolDefinition(),
  );

  printSmokeSection('ai-sdk bedrock smoke step 1 completion', firstCompletion);

  if (firstCompletion.kind !== 'success' || firstCompletion.result.step.kind !== 'tool-calls') {
    server.close();
    throw new Error('ai-sdk bedrock smoke step 1 未进入预期的 tool-calls。');
  }

  const resumedState = appendToolResultMessage(
    firstCompletion.result.state,
    BEDROCK_TOOL_USE_ID,
    '{"query":"Spirit Agent bedrock","result":"official provider ok"}',
  );

  const secondCompletion = await transport.startToolAgentRound(
    {
      transportKind: 'bedrock',
      apiKey: 'test-key',
      model: BEDROCK_MODEL,
      region: 'us-east-1',
      baseUrl,
    },
    resumedState,
    demoLookupToolDefinition(),
  );
  server.close();

  printSmokeSection('ai-sdk bedrock smoke step 2 completion', secondCompletion);
  printSmokeSection('ai-sdk bedrock smoke request bodies', requestBodies);

  if (secondCompletion.kind !== 'success' || secondCompletion.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk bedrock smoke step 2 未进入预期的 final-response-ready。');
  }

  const assistantText = extractLastAssistantText(secondCompletion.result.state)?.trim();
  if (assistantText !== 'AI_SDK_BEDROCK_OK') {
    throw new Error(`ai-sdk bedrock smoke step 2 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`);
  }

  const traceEntry = secondCompletion.result.requestTrace[0];
  if (!isJsonObject(traceEntry) || traceEntry.kind !== 'bedrock_sdk_converse') {
    throw new Error('ai-sdk bedrock smoke 未标记 Bedrock 专用 request trace kind。');
  }
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as JsonValue;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk bedrock smoke failed: ${message}`);
  process.exitCode = 1;
});
