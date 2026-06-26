import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayMoonshotProviderOptions,
  isGatewayMoonshotModel,
  isMoonshotThinkingSwitchEligibleModel,
  isMoonshotThinkingSwitchExcludedModel,
  isMoonshotThinkingSwitchModel,
} from './moonshot-thinking-switch.js';

test('isMoonshotThinkingSwitchEligibleModel covers kimi-k2.5+ only', () => {
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k2'), false);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k2-thinking'), false);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k2-turbo-preview'), false);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k2.5'), true);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k2.6'), true);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('kimi-k3'), true);
  assert.equal(isMoonshotThinkingSwitchEligibleModel('moonshotai/kimi-k2.5'), true);
});

test('isMoonshotThinkingSwitchExcludedModel blocks v1 and k2.7-code variants', () => {
  assert.equal(isMoonshotThinkingSwitchExcludedModel('moonshot-v1-8k'), true);
  assert.equal(isMoonshotThinkingSwitchExcludedModel('moonshot-v1-auto'), true);
  assert.equal(isMoonshotThinkingSwitchExcludedModel('kimi-k2.7-code'), true);
  assert.equal(isMoonshotThinkingSwitchExcludedModel('kimi-k2.7-code-highspeed'), true);
  assert.equal(isMoonshotThinkingSwitchExcludedModel('moonshotai/kimi-k2.7-code'), true);
  assert.equal(isMoonshotThinkingSwitchExcludedModel('kimi-k2.5'), false);
});

test('isMoonshotThinkingSwitchModel resolves direct and gateway providers', () => {
  const direct = {
    provider: 'moonshot-ai' as const,
    model: 'kimi-k2.5',
    transportKind: 'openai-compatible' as const,
  };
  const gateway = {
    provider: 'vercel-ai-gateway' as const,
    model: 'moonshotai/kimi-k2.6',
    transportKind: 'open-responses' as const,
  };
  const gatewayCode = {
    provider: 'vercel-ai-gateway' as const,
    model: 'moonshotai/kimi-k2.7-code',
    transportKind: 'open-responses' as const,
  };

  assert.equal(isMoonshotThinkingSwitchModel(direct), true);
  assert.equal(isMoonshotThinkingSwitchModel(gateway), true);
  assert.equal(isMoonshotThinkingSwitchModel(gatewayCode), false);
});

test('isGatewayMoonshotModel matches vercel-ai-gateway moonshotai routes only', () => {
  assert.equal(isGatewayMoonshotModel('vercel-ai-gateway', 'moonshotai/kimi-k2.5'), true);
  assert.equal(isGatewayMoonshotModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayMoonshotModel('moonshot-ai', 'kimi-k2.5'), false);
});

test('buildGatewayMoonshotProviderOptions toggles thinking for switchable models', () => {
  assert.deepEqual(
    buildGatewayMoonshotProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'moonshotai/kimi-k2.5',
      reasoningEffort: 'default',
      vendorExtendedThinking: false,
    }),
    {
      moonshotai: {
        thinking: { type: 'disabled' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayMoonshotProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'moonshotai/kimi-k2.5',
      reasoningEffort: 'low',
    }),
    {
      moonshotai: {
        thinking: { type: 'enabled' },
      },
      openai: {
        reasoningEffort: 'low',
      },
    },
  );

  assert.deepEqual(
    buildGatewayMoonshotProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'moonshotai/kimi-k2.7-code',
      reasoningEffort: 'low',
    }),
    {},
  );
});
