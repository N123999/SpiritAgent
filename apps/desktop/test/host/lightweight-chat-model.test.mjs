import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeLightweightChatModel,
  resolveLightweightChatModelName,
  resolveLightweightChatModelProfile,
} from '../../dist-electron/src/host/lightweight-chat-model.js';

const chatModel = {
  name: 'gpt-4o-mini',
  apiBase: 'https://api.openai.com/v1',
  reasoningEffort: 'default',
  capabilities: ['chat'],
};

const flashModel = {
  name: 'deepseek/deepseek-v4-flash',
  apiBase: 'https://api.example.com/v1',
  reasoningEffort: 'default',
  capabilities: ['chat'],
};

const imageOnlyModel = {
  name: 'dall-e-3',
  apiBase: 'https://api.openai.com/v1',
  reasoningEffort: 'default',
  capabilities: ['imageGeneration'],
};

test('resolveLightweightChatModelName prefers explicit lightweightChatModel', () => {
  const name = resolveLightweightChatModelName({
    activeModel: 'gpt-4o-mini',
    lightweightChatModel: 'deepseek/deepseek-v4-flash',
    models: [chatModel, flashModel],
  });

  assert.equal(name, 'deepseek/deepseek-v4-flash');
});

test('resolveLightweightChatModelName ignores invalid explicit config', () => {
  const name = resolveLightweightChatModelName({
    activeModel: 'gpt-4o-mini',
    lightweightChatModel: 'missing-model',
    models: [chatModel, flashModel],
  });

  assert.equal(name, 'deepseek/deepseek-v4-flash');
});

test('resolveLightweightChatModelName ignores non-chat explicit config', () => {
  const name = resolveLightweightChatModelName({
    activeModel: 'gpt-4o-mini',
    lightweightChatModel: 'dall-e-3',
    models: [chatModel, imageOnlyModel],
  });

  assert.equal(name, 'gpt-4o-mini');
});

test('resolveLightweightChatModelName falls back to pattern match before activeModel', () => {
  const name = resolveLightweightChatModelName({
    activeModel: 'gpt-4o-mini',
    models: [chatModel, flashModel],
  });

  assert.equal(name, 'deepseek/deepseek-v4-flash');
});

test('resolveLightweightChatModelName falls back to activeModel when no pattern matches', () => {
  const name = resolveLightweightChatModelName({
    activeModel: 'gpt-4o-mini',
    models: [chatModel],
  });

  assert.equal(name, 'gpt-4o-mini');
});

test('normalizeLightweightChatModel only keeps chat-capable models', () => {
  assert.equal(
    normalizeLightweightChatModel('dall-e-3', [imageOnlyModel]),
    undefined,
  );
  assert.equal(
    normalizeLightweightChatModel('gpt-4o-mini', [chatModel]),
    'gpt-4o-mini',
  );
});

test('resolveLightweightChatModelProfile returns profile for resolved model', () => {
  const resolved = resolveLightweightChatModelProfile({
    activeModel: 'gpt-4o-mini',
    lightweightChatModel: 'deepseek/deepseek-v4-flash',
    models: [chatModel, flashModel],
  });

  assert.deepEqual(resolved, {
    name: 'deepseek/deepseek-v4-flash',
    profile: flashModel,
  });
});
