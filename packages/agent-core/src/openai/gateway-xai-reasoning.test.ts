import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayXaiProviderOptions,
  isGatewayXaiModel,
  resolveXaiProviderReasoningEffort,
} from './gateway-xai-reasoning.js';

test('resolveXaiProviderReasoningEffort accepts none and medium', () => {
  assert.equal(resolveXaiProviderReasoningEffort('none'), 'none');
  assert.equal(resolveXaiProviderReasoningEffort('medium'), 'medium');
  assert.equal(resolveXaiProviderReasoningEffort('default'), undefined);
});

test('isGatewayXaiModel matches vercel-ai-gateway xai routes only', () => {
  assert.equal(isGatewayXaiModel('vercel-ai-gateway', 'xai/grok-4.3'), true);
  assert.equal(isGatewayXaiModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayXaiModel('xai', 'grok-4.3'), false);
});

test('buildGatewayXaiProviderOptions uses xai namespace for reasoningEffort none', () => {
  assert.deepEqual(
    buildGatewayXaiProviderOptions('vercel-ai-gateway', 'xai/grok-4.3', 'none'),
    {
      xai: {
        reasoningEffort: 'none',
      },
    },
  );

  assert.deepEqual(
    buildGatewayXaiProviderOptions('vercel-ai-gateway', 'xai/grok-build-0.1', 'high'),
    {
      xai: {
        reasoningEffort: 'high',
      },
    },
  );

  assert.deepEqual(
    buildGatewayXaiProviderOptions('vercel-ai-gateway', 'xai/grok-4.3', 'default'),
    {},
  );
});
