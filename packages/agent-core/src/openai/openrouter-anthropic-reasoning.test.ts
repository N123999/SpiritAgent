import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenRouterClaudeReasoningBody,
  isOpenRouterAnthropicClaudeModel,
  patchResponsesRequestBodyForOpenRouterReasoning,
  shouldInjectOpenRouterClaudeReasoning,
} from './openrouter-anthropic-reasoning.js';
import { openAiVendorChatCompletionBodyExtras } from './openai-compat.js';

test('isOpenRouterAnthropicClaudeModel matches openrouter anthropic routes only', () => {
  assert.equal(
    isOpenRouterAnthropicClaudeModel('openrouter', 'anthropic/claude-sonnet-4.6'),
    true,
  );
  assert.equal(
    isOpenRouterAnthropicClaudeModel('vercel-ai-gateway', 'anthropic/claude-sonnet-4.6'),
    false,
  );
  assert.equal(
    isOpenRouterAnthropicClaudeModel('openrouter', 'openai/gpt-5'),
    false,
  );
});

test('buildOpenRouterClaudeReasoningBody sends adaptive enabled for sonnet 4.6 default effort', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      reasoningEffort: 'default',
    }),
    { enabled: true },
  );
});

test('buildOpenRouterClaudeReasoningBody maps effort for opus 4.8', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-opus-4.8',
      reasoningEffort: 'medium',
    }),
    { enabled: true, effort: 'medium' },
  );
});

test('buildOpenRouterClaudeReasoningBody uses fixed budget max_tokens for legacy claude', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4-5',
      reasoningEffort: 'medium',
    }),
    { enabled: true, max_tokens: 12_000 },
  );
});

test('buildOpenRouterClaudeReasoningBody enables budget thinking for legacy claude at default effort', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4-5',
      reasoningEffort: 'default',
    }),
    { enabled: true, max_tokens: 12_000 },
  );
});

test('buildOpenRouterClaudeReasoningBody disables budget thinking when vendorExtendedThinking false', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-opus-4-5',
      reasoningEffort: 'medium',
      vendorExtendedThinking: false,
    }),
    { enabled: false },
  );
});

test('buildOpenRouterClaudeReasoningBody maps none to effort none', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      reasoningEffort: 'none',
    }),
    { effort: 'none' },
  );
});

test('buildOpenRouterClaudeReasoningBody disables adaptive thinking when vendorExtendedThinking false', () => {
  assert.deepEqual(
    buildOpenRouterClaudeReasoningBody({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-opus-4-8',
      reasoningEffort: 'high',
      vendorExtendedThinking: false,
    }),
    { enabled: false },
  );
});

test('shouldInjectOpenRouterClaudeReasoning follows buildOpenRouterClaudeReasoningBody', () => {
  assert.equal(
    shouldInjectOpenRouterClaudeReasoning({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      reasoningEffort: 'medium',
    }),
    true,
  );
  assert.equal(
    shouldInjectOpenRouterClaudeReasoning({
      llmVendor: 'openrouter',
      model: 'openai/gpt-5',
      reasoningEffort: 'medium',
    }),
    false,
  );
});

test('patchResponsesRequestBodyForOpenRouterReasoning writes reasoning and strips reasoning_effort', () => {
  const body = {
    model: 'anthropic/claude-sonnet-4.6',
    reasoning_effort: 'medium',
  };

  patchResponsesRequestBodyForOpenRouterReasoning(body, {
    llmVendor: 'openrouter',
    model: 'anthropic/claude-sonnet-4.6',
    reasoningEffort: 'medium',
  });

  assert.deepEqual(body, {
    model: 'anthropic/claude-sonnet-4.6',
    reasoning: { enabled: true, effort: 'medium' },
  });
});

test('openAiVendorChatCompletionBodyExtras injects reasoning for openrouter claude', () => {
  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras({
      llmVendor: 'openrouter',
      model: 'anthropic/claude-sonnet-4.6',
      reasoningEffort: 'medium',
    }),
    {
      reasoning: { enabled: true, effort: 'medium' },
    },
  );
});
