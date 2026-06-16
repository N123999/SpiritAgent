import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { JsonValue } from '../../ports.js';
import { AiSdkOpenAiCompatibleTransport } from '../../openai/ai-sdk-transport.js';
import {
  extractLastOpenAiAssistantText,
  startOpenAiToolAgentState,
} from '../../openai/tool-agent-helpers.js';
import { isJsonObject } from '../../tool-agent.js';

import { printSmokeSection } from '../shared/index.js';

const VERTEX_MODEL = 'gemini-2.5-flash';
const VERTEX_PROJECT = 'smoke-project';
const VERTEX_LOCATION = 'us-central1';

function vertexStreamChunks(text: string): string[] {
  return [
    `data: ${JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    })}\n\n`,
  ];
}

async function main(): Promise<void> {
  let capturedUrl = '';
  const requestBodies: JsonValue[] = [];

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.includes(':streamGenerateContent')) {
      response.statusCode = 404;
      response.end('not found');
      return;
    }

    capturedUrl = request.url;
    requestBodies.push(await readJsonBody(request));

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });

    for (const chunk of vertexStreamChunks('AI_SDK_GOOGLE_VERTEX_OK')) {
      response.write(chunk);
    }
    response.end();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法获取本地 smoke server 端口。');
  }

  const port = (address as AddressInfo).port;
  const baseUrl =
    `http://127.0.0.1:${port}/v1beta1/projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google`;
  const transport = new AiSdkOpenAiCompatibleTransport();
  const state = startOpenAiToolAgentState(
    [],
    'Reply with the smoke token.',
    process.cwd(),
    [],
    [],
    [],
    VERTEX_MODEL,
  );

  const started = await transport.startToolAgentRoundStreaming(
    {
      apiKey: '',
      model: VERTEX_MODEL,
      baseUrl,
      llmVendor: 'google-vertex-ai',
      vertexProject: VERTEX_PROJECT,
      vertexLocation: VERTEX_LOCATION,
      vertexGoogleAuthOptions: {
        authClient: {
          getAccessToken: async () => ({ token: 'smoke-token' }),
        },
      },
    },
    state,
    [],
  );

  const events: JsonValue[] = [];
  for await (const event of started.eventStream) {
    events.push(event as JsonValue);
  }

  const completion = await started.completion;
  server.close();

  printSmokeSection('ai-sdk google vertex streaming smoke events', events);
  printSmokeSection('ai-sdk google vertex streaming smoke completion', completion);
  printSmokeSection('ai-sdk google vertex streaming smoke request bodies', requestBodies);

  if (!capturedUrl.includes(':streamGenerateContent')) {
    throw new Error('ai-sdk google vertex streaming smoke 未命中 streamGenerateContent 端点。');
  }

  if (completion.kind !== 'success' || completion.result.step.kind !== 'final-response-ready') {
    throw new Error('ai-sdk google vertex streaming smoke 未进入预期的 final-response-ready。');
  }

  const assistantText = extractLastOpenAiAssistantText(completion.result.state)?.trim();
  if (assistantText !== 'AI_SDK_GOOGLE_VERTEX_OK') {
    throw new Error(
      `ai-sdk google vertex streaming smoke 未拿到预期最终 assistant 文本。实际: ${assistantText ?? '<empty>'}`,
    );
  }

  const traceEntry = completion.result.requestTrace[0];
  if (!isJsonObject(traceEntry) || traceEntry.kind !== 'google_vertex_sdk_generate_content') {
    throw new Error('ai-sdk google vertex streaming smoke 未标记 Vertex 专用 request trace kind。');
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
  console.error(`ai-sdk google vertex streaming smoke failed: ${message}`);
  process.exitCode = 1;
});
