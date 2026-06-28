import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResponsesRoundInput, responsesUsesStoredState } from './responses-incremental-input.js';

test('responsesUsesStoredState is true for openai and azure providers', () => {
  assert.equal(
    responsesUsesStoredState({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    }),
    true,
  );
  assert.equal(
    responsesUsesStoredState({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'deploy',
      responsesProvider: 'azure',
      llmVendor: 'azure',
      azureResourceName: 'r',
    }),
    true,
  );
  assert.equal(
    responsesUsesStoredState({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'qwen3-max',
      llmVendor: 'alibaba',
    }),
    true,
  );
  assert.equal(
    responsesUsesStoredState({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'doubao-seed-1-8-251228',
      llmVendor: 'volcengine',
    }),
    true,
  );
  assert.equal(
    responsesUsesStoredState({
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'grok-3',
      responsesProvider: 'xai',
      llmVendor: 'xai',
    }),
    false,
  );
});

test('buildResponsesRoundInput returns full messages without a response chain', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' },
  ];
  const result = buildResponsesRoundInput(
    messages,
    {
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    },
    1,
  );

  assert.equal(result.mode, 'full');
  assert.equal(result.previousResponseId, undefined);
  assert.equal(result.apiMessages.length, 2);
});

test('buildResponsesRoundInput slices delta after anchored assistant', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    {
      role: 'assistant',
      content: 'done',
      providerState: { openAiResponses: { responseId: 'resp_prev' } },
    },
    { role: 'user', content: 'next' },
  ];
  const result = buildResponsesRoundInput(
    messages,
    {
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    },
    1,
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(result.previousResponseId, 'resp_prev');
  assert.equal(result.apiMessages.length, 2);
  assert.equal((result.apiMessages[0] as { role: string }).role, 'system');
  assert.equal((result.apiMessages[1] as { role: string }).role, 'user');
});

test('buildResponsesRoundInput tool loop sends only post-anchor delta', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'go' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }],
      providerState: { openAiResponses: { responseId: 'resp_tool' } },
    },
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
  ];
  const result = buildResponsesRoundInput(
    messages,
    {
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    },
    2,
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(result.apiMessages.length, 1);
  assert.equal((result.apiMessages[0] as { role: string }).role, 'tool');
});

test('buildResponsesRoundInput cross-turn includes system and user only', () => {
  const messages = [
    { role: 'system', content: 'sys-v2' },
    { role: 'user', content: 'old' },
    {
      role: 'assistant',
      content: 'prior answer',
      providerState: { openAiResponses: { responseId: 'resp_cross' } },
    },
    { role: 'user', content: 'new turn' },
  ];
  const result = buildResponsesRoundInput(
    messages,
    {
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    },
    1,
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(result.apiMessages.length, 2);
  assert.equal((result.apiMessages[0] as { role: string }).role, 'system');
  assert.equal((result.apiMessages[1] as { content: string }).content, 'new turn');
});

test('buildResponsesRoundInput reads top-level openAiResponses from history spread', () => {
  const messages = [
    { role: 'system', content: 'sys' },
    {
      role: 'assistant',
      content: 'done',
      openAiResponses: { responseId: 'resp_spread' },
    },
    { role: 'user', content: 'follow up' },
  ];
  const result = buildResponsesRoundInput(
    messages,
    {
      transportKind: 'open-responses',
      apiKey: 'k',
      model: 'gpt-5',
      responsesProvider: 'openai',
      llmVendor: 'openai',
    },
    1,
  );

  assert.equal(result.mode, 'incremental');
  assert.equal(result.previousResponseId, 'resp_spread');
});
