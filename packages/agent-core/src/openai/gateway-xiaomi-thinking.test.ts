import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDirectXiaomiResponsesProviderOptions,
  buildGatewayXiaomiProviderOptions,
  buildGatewayXiaomiResponsesProviderOptions,
  isGatewayXiaomiModel,
  isXiaomiResponsesReasoningEffortContext,
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

test('isXiaomiResponsesReasoningEffortContext matches open-responses MiMo routes only', () => {
  assert.equal(
    isXiaomiResponsesReasoningEffortContext({
      provider: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2.5',
      transportKind: 'open-responses',
    }),
    true,
  );
  assert.equal(
    isXiaomiResponsesReasoningEffortContext({
      provider: 'xiaomi',
      model: 'mimo-v2.5',
      transportKind: 'open-responses',
    }),
    true,
  );
  assert.equal(
    isXiaomiResponsesReasoningEffortContext({
      provider: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2.5',
      transportKind: 'openai-compatible',
    }),
    false,
  );
  assert.equal(
    isXiaomiResponsesReasoningEffortContext({
      provider: 'vercel-ai-gateway',
      model: 'xiaomi/mimo-v2-flash',
      transportKind: 'open-responses',
    }),
    false,
  );
});

test('buildGatewayXiaomiResponsesProviderOptions maps reasoningEffort via openai namespace', () => {
  assert.deepEqual(
    buildGatewayXiaomiResponsesProviderOptions(
      {
        llmVendor: 'vercel-ai-gateway',
        model: 'xiaomi/mimo-v2.5',
      },
      'none',
    ),
    {
      openai: {
        reasoningEffort: 'none',
      },
    },
  );

  assert.deepEqual(
    buildGatewayXiaomiResponsesProviderOptions(
      {
        llmVendor: 'vercel-ai-gateway',
        model: 'xiaomi/mimo-v2.5',
      },
      'medium',
      'auto',
    ),
    {
      openai: {
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
      },
    },
  );

  assert.deepEqual(
    buildGatewayXiaomiResponsesProviderOptions(
      {
        llmVendor: 'vercel-ai-gateway',
        model: 'xiaomi/mimo-v2-flash',
      },
      'none',
    ),
    {},
  );
});

test('buildDirectXiaomiResponsesProviderOptions maps reasoningEffort via openai namespace', () => {
  assert.deepEqual(
    buildDirectXiaomiResponsesProviderOptions(
      {
        llmVendor: 'xiaomi',
        model: 'mimo-v2.5-pro',
      },
      'none',
    ),
    {
      openai: {
        reasoningEffort: 'none',
      },
    },
  );
});
