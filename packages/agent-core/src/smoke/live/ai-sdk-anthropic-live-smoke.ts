import { AiSdkAnthropicTransport } from '../../anthropic/ai-sdk-transport.js';
import type { OpenAiJsonSchemaCompletionRequest } from '../../openai/json-schema.js';

import { printSmokeSection } from '../shared/print.js';
import { createLiveAnthropicSmokeConfig, shouldRunLiveSmoke } from './env.js';

async function main(): Promise<void> {
  if (!shouldRunLiveSmoke()) {
    return;
  }

  const config = createLiveAnthropicSmokeConfig();
  const transport = new AiSdkAnthropicTransport();
  const request: OpenAiJsonSchemaCompletionRequest = {
    userPrompt: 'Return a JSON object with message set to LIVE_SMOKE_OK.',
    schemaName: 'live_smoke_result',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: {
          type: 'string',
        },
      },
      required: ['message'],
    },
  };

  const result = await transport.createJsonSchemaCompletion<{ message: string }>(config, request);
  printSmokeSection('live anthropic json-schema smoke', {
    model: config.model,
    baseUrl: config.baseUrl,
    output: result.output,
    requestTraceCount: result.requestTrace.length,
  });

  if (!result.output.message.trim()) {
    throw new Error('live anthropic smoke 未拿到非空 JSON message。');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`live anthropic smoke failed: ${message}`);
  process.exitCode = 1;
});