import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayAlibabaProviderOptions,
  isGatewayAlibabaModel,
} from './gateway-alibaba-thinking.js';

test('isGatewayAlibabaModel matches vercel-ai-gateway alibaba routes only', () => {
  assert.equal(isGatewayAlibabaModel('vercel-ai-gateway', 'alibaba/qwen3-max'), true);
  assert.equal(isGatewayAlibabaModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayAlibabaModel('alibaba', 'qwen3-max'), false);
});

test('buildGatewayAlibabaProviderOptions disables thinking via alibaba namespace', () => {
  assert.deepEqual(
    buildGatewayAlibabaProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'alibaba/qwen3-max',
      vendorExtendedThinking: false,
    }),
    {
      alibaba: {
        enableThinking: false,
      },
    },
  );

  assert.deepEqual(
    buildGatewayAlibabaProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'alibaba/qwen3-max',
    }),
    {},
  );
});
