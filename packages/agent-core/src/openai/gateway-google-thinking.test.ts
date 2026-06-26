import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGatewayGoogleProviderOptions,
  buildGoogleThinkingConfigForEffort,
  gatewayGoogleGeminiSupportedEfforts,
  isGatewayGoogleGeminiModel,
  isGoogleGeminiMinimalThinkingLevelModel,
} from './gateway-google-thinking.js';

test('isGatewayGoogleGeminiModel matches vercel-ai-gateway google gemini routes only', () => {
  assert.equal(
    isGatewayGoogleGeminiModel('vercel-ai-gateway', 'google/gemini-3.1-pro-preview'),
    true,
  );
  assert.equal(
    isGatewayGoogleGeminiModel('vercel-ai-gateway', 'google/gemini-2.5-flash'),
    true,
  );
  assert.equal(
    isGatewayGoogleGeminiModel('vercel-ai-gateway', 'openai/gpt-5'),
    false,
  );
  assert.equal(
    isGatewayGoogleGeminiModel('vercel-ai-gateway', 'google/imagen-4'),
    false,
  );
  assert.equal(
    isGatewayGoogleGeminiModel('google', 'google/gemini-3.1-pro-preview'),
    false,
  );
});

test('isGoogleGeminiMinimalThinkingLevelModel matches flash routes only', () => {
  assert.equal(
    isGoogleGeminiMinimalThinkingLevelModel('google/gemini-3-flash-preview'),
    true,
  );
  assert.equal(
    isGoogleGeminiMinimalThinkingLevelModel('google/gemini-3.1-pro-preview'),
    false,
  );
});

test('buildGoogleThinkingConfigForEffort maps Gemini 3 and 2.5 effort levels', () => {
  assert.deepEqual(
    buildGoogleThinkingConfigForEffort('google/gemini-3.1-pro-preview', 'high'),
    {
      thinkingLevel: 'high',
      includeThoughts: true,
    },
  );
  assert.deepEqual(
    buildGoogleThinkingConfigForEffort('google/gemini-2.5-flash', 'medium'),
    {
      thinkingBudget: 4096,
      includeThoughts: true,
    },
  );
  assert.deepEqual(
    buildGoogleThinkingConfigForEffort('google/gemini-3-flash-preview', 'minimal'),
    {
      thinkingLevel: 'minimal',
    },
  );
  assert.equal(
    buildGoogleThinkingConfigForEffort('google/gemini-3.1-pro-preview', 'none'),
    undefined,
  );
  assert.deepEqual(
    buildGoogleThinkingConfigForEffort('google/gemini-3-flash-preview', 'none'),
    {
      thinkingLevel: 'minimal',
    },
  );
});

test('buildGatewayGoogleProviderOptions sends google thinkingConfig for gateway gemini', () => {
  assert.deepEqual(
    buildGatewayGoogleProviderOptions(
      {
        llmVendor: 'vercel-ai-gateway',
        model: 'google/gemini-3.1-pro-preview',
        reasoningEffort: 'medium',
      },
      'medium',
    ),
    {
      google: {
        thinkingConfig: {
          thinkingLevel: 'medium',
          includeThoughts: true,
        },
      },
    },
  );
});

test('gatewayGoogleGeminiSupportedEfforts exports effort vocabulary for catalog metadata', () => {
  assert.deepEqual(
    gatewayGoogleGeminiSupportedEfforts('google/gemini-3.1-pro-preview'),
    ['low', 'medium', 'high'],
  );
  assert.deepEqual(
    gatewayGoogleGeminiSupportedEfforts('google/gemini-3-flash-preview'),
    ['minimal', 'low', 'medium', 'high'],
  );
  assert.deepEqual(
    gatewayGoogleGeminiSupportedEfforts('google/gemini-2.5-flash'),
    ['none', 'low', 'medium', 'high'],
  );
  assert.equal(gatewayGoogleGeminiSupportedEfforts('openai/gpt-5'), undefined);
});
