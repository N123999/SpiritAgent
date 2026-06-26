import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayMinimaxProviderOptions,
  isGatewayMinimaxModel,
  isMinimaxM3ThinkingSwitchModel,
} from './gateway-minimax-thinking.js';

test('isMinimaxM3ThinkingSwitchModel matches MiniMax M3 routes only', () => {
  assert.equal(isMinimaxM3ThinkingSwitchModel('minimax/minimax-m3'), true);
  assert.equal(isMinimaxM3ThinkingSwitchModel('minimax/MiniMax-M3'), true);
  assert.equal(isMinimaxM3ThinkingSwitchModel('minimax/MiniMax-M2.5'), false);
});

test('isGatewayMinimaxModel matches vercel-ai-gateway minimax routes only', () => {
  assert.equal(isGatewayMinimaxModel('vercel-ai-gateway', 'minimax/minimax-m3'), true);
  assert.equal(isGatewayMinimaxModel('vercel-ai-gateway', 'openai/gpt-5'), false);
  assert.equal(isGatewayMinimaxModel('minimax', 'MiniMax-M3'), false);
});

test('buildGatewayMinimaxProviderOptions toggles thinking via minimax namespace', () => {
  assert.deepEqual(
    buildGatewayMinimaxProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'minimax/minimax-m3',
      vendorExtendedThinking: false,
    }),
    {
      minimax: {
        thinking: { type: 'disabled' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayMinimaxProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'minimax/minimax-m3',
    }),
    {
      minimax: {
        thinking: { type: 'adaptive' },
      },
    },
  );

  assert.deepEqual(
    buildGatewayMinimaxProviderOptions({
      llmVendor: 'vercel-ai-gateway',
      model: 'minimax/MiniMax-M2.5',
    }),
    {
      minimax: {
        thinking: { type: 'adaptive' },
      },
    },
  );
});
