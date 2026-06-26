import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCodeCompletionTransportProfile,
  isCodeCompletionTransportProfile,
} from './transport-profile.js';
import type { AnthropicTransportConfig } from '../anthropic/anthropic-compat.js';
import type { BedrockTransportConfig } from '../bedrock/bedrock-compat.js';
import { buildBedrockProviderOptions } from '../bedrock/bedrock-compat.js';
import type { OpenAiTransportConfig } from '../openai/openai-compat.js';
import type { OpenResponsesTransportConfig } from '../open-responses/responses-compat.js';
import { openAiVendorChatCompletionBodyExtras } from '../openai/openai-compat.js';

test('isCodeCompletionTransportProfile matches code-completion only', () => {
  assert.equal(isCodeCompletionTransportProfile({ transportRequestProfile: 'code-completion' }), true);
  assert.equal(isCodeCompletionTransportProfile({ transportRequestProfile: 'agent' }), false);
  assert.equal(isCodeCompletionTransportProfile({}), false);
});

test('applyCodeCompletionTransportProfile disables DeepSeek thinking', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'deepseek-v4-flash',
    llmVendor: 'deepseek',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'default');
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, false);
});

test('applyCodeCompletionTransportProfile disables Moonshot thinking', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'kimi-k2.5',
    llmVendor: 'moonshot-ai',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'default');
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, false);
});

test('applyCodeCompletionTransportProfile disables OpenAI reasoning on openai-compatible transport', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'gpt-5',
    llmVendor: 'openai',
    reasoningEffort: 'medium',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
});

test('applyCodeCompletionTransportProfile disables Google Gemini thinking on openai-compatible transport', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'gemini-2.5-flash',
    llmVendor: 'google',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
});

test('applyCodeCompletionTransportProfile disables Google Vertex Gemini thinking on openai-compatible transport', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'gemini-2.5-flash',
    llmVendor: 'google-vertex-ai',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
});

test('applyCodeCompletionTransportProfile disables xAI reasoning on openai-compatible transport', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'grok-4.3',
    llmVendor: 'xai',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
});

test('applyCodeCompletionTransportProfile leaves unrelated openai-compatible vendors unchanged except profile tag', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'Qwen/Qwen3-8B',
    llmVendor: 'siliconflow',
    reasoningEffort: 'medium',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).vendorExtendedThinking, undefined);
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'medium');
});

test('applyCodeCompletionTransportProfile disables custom vendor reasoning on openai-compatible transport', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'local-model',
    llmVendor: 'custom',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
});

test('applyCodeCompletionTransportProfile disables OpenAI reasoning on open-responses transport', () => {
  const input: OpenResponsesTransportConfig = {
    transportKind: 'open-responses',
    apiKey: 'k',
    model: 'gpt-5',
    llmVendor: 'openai',
    reasoningEffort: 'high',
    reasoningSummary: 'detailed',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenResponsesTransportConfig).reasoningEffort, 'none');
  assert.equal((result as OpenResponsesTransportConfig).reasoningSummary, 'off');
});

test('applyCodeCompletionTransportProfile disables xAI reasoning on open-responses transport', () => {
  const input: OpenResponsesTransportConfig = {
    transportKind: 'open-responses',
    apiKey: 'k',
    model: 'grok-4',
    llmVendor: 'xai',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal((result as OpenResponsesTransportConfig).reasoningEffort, 'none');
  assert.equal((result as OpenResponsesTransportConfig).reasoningSummary, 'off');
});

test('applyCodeCompletionTransportProfile disables OpenRouter Claude reasoning effort none', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'anthropic/claude-sonnet-4.6',
    llmVendor: 'openrouter',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
  assert.deepEqual(
    openAiVendorChatCompletionBodyExtras(result as OpenAiTransportConfig),
    { reasoning: { effort: 'none' } },
  );
});

test('applyCodeCompletionTransportProfile disables OpenRouter non-Claude reasoning', () => {
  const input: OpenAiTransportConfig = {
    apiKey: 'k',
    model: 'openai/gpt-4o',
    llmVendor: 'openrouter',
    reasoningEffort: 'medium',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenAiTransportConfig).reasoningEffort, 'none');
  assert.deepEqual(openAiVendorChatCompletionBodyExtras(result as OpenAiTransportConfig), {});
});

test('applyCodeCompletionTransportProfile disables Azure OpenAI reasoning on open-responses transport', () => {
  const input: OpenResponsesTransportConfig = {
    transportKind: 'open-responses',
    apiKey: 'k',
    model: 'gpt-5',
    llmVendor: 'azure',
    responsesProvider: 'azure',
    reasoningEffort: 'high',
    reasoningSummary: 'detailed',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal((result as OpenResponsesTransportConfig).reasoningEffort, 'none');
  assert.equal((result as OpenResponsesTransportConfig).reasoningSummary, 'off');
});

test('applyCodeCompletionTransportProfile disables Anthropic extended thinking', () => {
  const input: AnthropicTransportConfig = {
    transportKind: 'anthropic',
    apiKey: 'k',
    model: 'claude-sonnet-4-6',
    effort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input);
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.deepEqual((result as AnthropicTransportConfig).thinking, { type: 'disabled' });
});

test('applyCodeCompletionTransportProfile disables Bedrock reasoning on code completion', () => {
  const input: BedrockTransportConfig = {
    transportKind: 'bedrock',
    model: 'anthropic.claude-sonnet-4-6',
    region: 'us-east-1',
    reasoningEffort: 'high',
  };
  const result = applyCodeCompletionTransportProfile(input) as BedrockTransportConfig;
  assert.equal(result.transportRequestProfile, 'code-completion');
  assert.equal(result.reasoningEffort, 'none');
  assert.deepEqual(buildBedrockProviderOptions(result), {});
});

test('applyCodeCompletionTransportProfile tags anthropic, open-responses, and bedrock transports', () => {
  const anthropic: AnthropicTransportConfig = {
    transportKind: 'anthropic',
    apiKey: 'k',
    model: 'claude-sonnet-4-6',
  };
  const openResponses: OpenResponsesTransportConfig = {
    transportKind: 'open-responses',
    apiKey: 'k',
    model: 'gpt-5',
    llmVendor: 'xai',
  };
  const bedrock: BedrockTransportConfig = {
    transportKind: 'bedrock',
    model: 'anthropic.claude-sonnet-4-6',
    region: 'us-east-1',
  };

  assert.equal(applyCodeCompletionTransportProfile(anthropic).transportRequestProfile, 'code-completion');
  assert.equal(applyCodeCompletionTransportProfile(openResponses).transportRequestProfile, 'code-completion');
  assert.equal(applyCodeCompletionTransportProfile(bedrock).transportRequestProfile, 'code-completion');
});
