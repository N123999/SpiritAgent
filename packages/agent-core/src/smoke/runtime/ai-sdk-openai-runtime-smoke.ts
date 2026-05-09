import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createAiSdkOpenAiDemoRuntime,
  printSmokeSection,
} from '../shared/index.js';

async function main(): Promise<void> {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    request.resume();

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
          id: 'chatcmpl-ai-sdk-runtime-tool-call',
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
                    id: 'call_ai_sdk_runtime_1',
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
        id: 'chatcmpl-ai-sdk-runtime-final',
        object: 'chat.completion',
        created: 0,
        model: 'test-openai-compatible',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'RUNTIME_OK',
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

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('无法获取本地 runtime smoke server 端口。');
    }

    const runtime = createAiSdkOpenAiDemoRuntime({
      config: {
        apiKey: 'test-key',
        model: 'test-openai-compatible',
        baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}/v1`,
      },
    });

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
  } finally {
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ai-sdk openai runtime smoke failed: ${message}`);
  process.exitCode = 1;
});