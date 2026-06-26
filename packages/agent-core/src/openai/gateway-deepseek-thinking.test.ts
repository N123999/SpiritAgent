import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayDeepSeekProviderOptions,
  isGatewayDeepSeekModel,
} from './gateway-deepseek-thinking.js';

test('isGatewayDeepSeekModel matches vercel-ai-gateway deepseek routes only', () => {
  assert.equal(isGatewayDeepSeekModel('vercel-ai-gateway', 'deepseek/deepseek-v4-pro'), true);
  assert.equal(isGatewayDeepSeekModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayDeepSeekModel('deepseek', 'deepseek-v4-pro'), false);
});

test('buildGatewayDeepSeekProviderOptions disables thinking for Gateway DeepSeek V4', () => {
  assert.deepEqual(
    buildGatewayDeepSeekProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'deepseek/deepseek-v4-pro',
      reasoningEffort: 'default',
      vendorExtendedThinking: false,
    }),
    {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    },
  );
});

test('buildGatewayDeepSeekProviderOptions enables thinking with effort for Gateway DeepSeek V4', () => {
  assert.deepEqual(
    buildGatewayDeepSeekProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'deepseek/deepseek-v4-pro',
      reasoningEffort: 'high',
    }),
    {
      deepseek: {
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      },
    },
  );
});

test('buildGatewayDeepSeekProviderOptions disables thinking for Gateway DeepSeek V3 slug', () => {
  assert.deepEqual(
    buildGatewayDeepSeekProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'deepseek/deepseek-v3.2',
      reasoningEffort: 'default',
      vendorExtendedThinking: false,
    }),
    {
      deepseek: {
        thinking: { type: 'disabled' },
      },
    },
  );
});
