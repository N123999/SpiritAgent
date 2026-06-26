import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayZaiProviderOptions,
  isGatewayZaiModel,
  isZaiThinkingSwitchEligibleModel,
} from './gateway-zai-thinking.js';

test('isZaiThinkingSwitchEligibleModel covers GLM-4.5+ only', () => {
  assert.equal(isZaiThinkingSwitchEligibleModel('glm-4.5'), true);
  assert.equal(isZaiThinkingSwitchEligibleModel('glm-4.7'), true);
  assert.equal(isZaiThinkingSwitchEligibleModel('glm-5.2'), true);
  assert.equal(isZaiThinkingSwitchEligibleModel('zai/glm-4.7'), true);
  assert.equal(isZaiThinkingSwitchEligibleModel('glm-4'), false);
});

test('isGatewayZaiModel matches vercel-ai-gateway zai routes only', () => {
  assert.equal(isGatewayZaiModel('vercel-ai-gateway', 'zai/glm-4.7'), true);
  assert.equal(isGatewayZaiModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayZaiModel('z-ai', 'glm-4.7'), false);
});

test('buildGatewayZaiProviderOptions toggles thinking for Gateway Z.ai', () => {
  assert.deepEqual(
    buildGatewayZaiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'zai/glm-4.7',
      reasoningEffort: 'default',
      vendorExtendedThinking: false,
    }),
    {
      zai: {
        thinking: { type: 'disabled' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayZaiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'zai/glm-4.7',
      reasoningEffort: 'high',
    }),
    {
      zai: {
        thinking: { type: 'enabled' },
      },
      openai: {
        reasoningEffort: 'high',
      },
    },
  );

  assert.deepEqual(
    buildGatewayZaiProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'zai/glm-4',
      reasoningEffort: 'high',
    }),
    {},
  );
});
