import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGatewayOpenAiRoutedModel,
  normalizeGatewayOpenAiModelId,
  resolveOpenResponsesLanguageModelId,
  resolveOpenResponsesSdkProvider,
} from './responses-compat.js';

test('normalizeGatewayOpenAiModelId', () => {
  assert.equal(normalizeGatewayOpenAiModelId('openai/gpt-5.1'), 'gpt-5.1');
  assert.equal(normalizeGatewayOpenAiModelId('anthropic/claude-sonnet-4'), undefined);
});

test('resolveOpenResponsesSdkProvider gateway openai route stays open-responses for reasoning', () => {
  // Gateway-routed OpenAI models must NOT use `@ai-sdk/openai` (which strips the
  // `openai/` prefix and suppresses gateway reasoning streaming). Default to the
  // generic open-responses provider.
  assert.equal(
    resolveOpenResponsesSdkProvider({
      llmVendor: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
    }),
    'open-responses-compatible',
  );
  assert.equal(
    resolveOpenResponsesSdkProvider({
      llmVendor: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
      responsesProvider: 'open-responses-compatible',
    }),
    'open-responses-compatible',
  );
});

test('resolveOpenResponsesSdkProvider honors explicit openai provider override', () => {
  assert.equal(
    resolveOpenResponsesSdkProvider({
      llmVendor: 'vercel-ai-gateway',
      model: 'openai/gpt-5.1',
      responsesProvider: 'openai',
    }),
    'openai',
  );
});

test('resolveOpenResponsesSdkProvider gateway non-openai route stays compatible', () => {
  assert.equal(
    resolveOpenResponsesSdkProvider({
      llmVendor: 'vercel-ai-gateway',
      model: 'anthropic/claude-sonnet-4',
    }),
    'open-responses-compatible',
  );
});

test('resolveOpenResponsesLanguageModelId strips gateway openai prefix', () => {
  assert.equal(
    resolveOpenResponsesLanguageModelId({
      llmVendor: 'vercel-ai-gateway',
      model: 'openai/gpt-5.4-mini',
    }),
    'gpt-5.4-mini',
  );
  assert.equal(
    resolveOpenResponsesLanguageModelId({
      llmVendor: 'openrouter',
      model: 'openai/gpt-5.4-mini',
    }),
    'gpt-5.4-mini',
  );
  assert.equal(
    resolveOpenResponsesLanguageModelId({
      llmVendor: 'openai',
      model: 'gpt-5.1',
    }),
    'gpt-5.1',
  );
});

test('resolveOpenResponsesSdkProvider openrouter stays open-responses-compatible', () => {
  assert.equal(
    resolveOpenResponsesSdkProvider({
      llmVendor: 'openrouter',
      model: 'openai/gpt-5.1',
    }),
    'open-responses-compatible',
  );
});

test('isGatewayOpenAiRoutedModel', () => {
  assert.equal(isGatewayOpenAiRoutedModel('openai/gpt-5.1'), true);
  assert.equal(isGatewayOpenAiRoutedModel('gpt-5.1'), false);
});
