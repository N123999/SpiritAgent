import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayXiaomiProviderOptions,
  isGatewayXiaomiModel,
  isXiaomiThinkingSwitchEligibleModel,
} from './gateway-xiaomi-thinking.js';

test('isXiaomiThinkingSwitchEligibleModel covers MiMo thinking models only', () => {
  assert.equal(isXiaomiThinkingSwitchEligibleModel('mimo-v2.5'), true);
  assert.equal(isXiaomiThinkingSwitchEligibleModel('mimo-v2.5-pro'), true);
  assert.equal(isXiaomiThinkingSwitchEligibleModel('xiaomi/mimo-v2.5'), true);
  assert.equal(isXiaomiThinkingSwitchEligibleModel('mimo-v2-flash'), false);
});

test('isGatewayXiaomiModel matches vercel-ai-gateway xiaomi routes only', () => {
  assert.equal(isGatewayXiaomiModel('vercel-ai-gateway', 'xiaomi/mimo-v2.5'), true);
  assert.equal(isGatewayXiaomiModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayXiaomiModel('xiaomi', 'mimo-v2.5'), false);
});

test('buildGatewayXiaomiProviderOptions toggles thinking for MiMo on Gateway', () => {
  assert.deepEqual(
    buildGatewayXiaomiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2.5',
      vendorExtendedThinking: false,
    }),
    {
      xiaomi: {
        thinking: { type: 'disabled' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayXiaomiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2.5',
    }),
    {
      xiaomi: {
        thinking: { type: 'enabled' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayXiaomiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2-flash',
      vendorExtendedThinking: false,
    }),
    {},
  );
});
