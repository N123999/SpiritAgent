import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyModelsRemovalToConfig,
  buildModelSecretKeyPresence,
  filterNewProviderModelIds,
  modelExistsInProviderScope,
  modelProviderKeyScope,
  providerKeyAccount,
  resolveActiveModelAfterRemoval,
} from '../../dist-electron/src/host/provider-api-key.js';

test('providerKeyAccount uses provider namespace', () => {
  assert.equal(providerKeyAccount('vercel-ai-gateway'), 'provider::vercel-ai-gateway');
  assert.equal(providerKeyAccount('openrouter'), 'provider::openrouter');
  assert.equal(providerKeyAccount('custom'), 'provider::custom');
});

test('modelProviderKeyScope defaults missing provider to custom', () => {
  assert.equal(modelProviderKeyScope(undefined), 'custom');
  assert.equal(modelProviderKeyScope('openai'), 'openai');
});

test('buildModelSecretKeyPresence reads each provider once', () => {
  const providerReads = [];
  const modelReads = [];

  const presence = buildModelSecretKeyPresence(
    [
      { name: 'a', provider: 'openai' },
      { name: 'b', provider: 'openai' },
      { name: 'c', provider: 'anthropic' },
      { name: 'legacy-only' },
    ],
    (providerId, _profile) => {
      providerReads.push(providerId);
      return providerId === 'openai';
    },
    (modelName) => {
      modelReads.push(modelName);
      return modelName === 'legacy-only';
    },
  );

  assert.deepEqual(providerReads, ['openai', 'anthropic', 'custom']);
  assert.deepEqual(modelReads, ['c', 'legacy-only']);
  assert.equal(presence.a, true);
  assert.equal(presence.b, true);
  assert.equal(presence.c, false);
  assert.equal(presence['legacy-only'], true);
});

test('buildModelSecretKeyPresence prefers provider key over per-model key', () => {
  const presence = buildModelSecretKeyPresence(
    [{ name: 'gpt-4', provider: 'openai' }],
    () => true,
    () => false,
  );
  assert.equal(presence['gpt-4'], true);
});

test('modelExistsInProviderScope only matches same provider scope', () => {
  const existing = [
    { name: 'gpt-4', provider: 'openai' },
    { name: 'gpt-4', provider: 'vercel-ai-gateway' },
  ];
  assert.equal(modelExistsInProviderScope(existing, 'gpt-4', 'openai'), true);
  assert.equal(modelExistsInProviderScope(existing, 'gpt-4', 'anthropic'), false);
  assert.equal(modelExistsInProviderScope(existing, 'gpt-4'), false);
});

test('resolveActiveModelAfterRemoval switches to another model or clears active', () => {
  const remaining = [{ name: 'b' }, { name: 'c' }];
  assert.equal(
    resolveActiveModelAfterRemoval('a', remaining, ['a']),
    'b',
  );
  assert.equal(
    resolveActiveModelAfterRemoval('a', [], ['a']),
    '',
  );
  assert.equal(
    resolveActiveModelAfterRemoval('b', remaining, ['a']),
    'b',
  );
});

test('applyModelsRemovalToConfig clears default slots when active model is removed', () => {
  const config = {
    models: [
      { name: 'a', provider: 'openai' },
      { name: 'b', provider: 'openai' },
    ],
    activeModel: 'a',
    imageGenerationModel: 'a',
    videoGenerationModel: 'b',
    lightweightChatModel: 'a',
  };

  assert.equal(applyModelsRemovalToConfig(config, [{ name: 'a', provider: 'openai' }]), 1);
  assert.deepEqual(
    config.models.map((model) => model.name),
    ['b'],
  );
  assert.equal(config.activeModel, 'b');
  assert.equal(config.imageGenerationModel, undefined);
  assert.equal(config.videoGenerationModel, 'b');
  assert.equal(config.lightweightChatModel, undefined);
});

test('applyModelsRemovalToConfig only removes models in the same provider scope', () => {
  const config = {
    models: [
      { name: 'shared-id', provider: 'openai' },
      { name: 'shared-id', provider: 'vercel-ai-gateway' },
    ],
    activeModel: 'shared-id',
    videoGenerationModel: 'shared-id',
  };

  assert.equal(
    applyModelsRemovalToConfig(config, [{ name: 'shared-id', provider: 'openai' }]),
    1,
  );
  assert.deepEqual(
    config.models.map((model) => model.provider),
    ['vercel-ai-gateway'],
  );
  assert.equal(config.activeModel, 'shared-id');
  assert.equal(config.videoGenerationModel, 'shared-id');
});

test('filterNewProviderModelIds skips only duplicates within provider scope', () => {
  const existing = [{ name: 'shared-id', provider: 'openai' }];
  const filtered = filterNewProviderModelIds(
    existing,
    ['shared-id', 'new-id'],
    'vercel-ai-gateway',
  );
  assert.deepEqual(filtered, ['shared-id', 'new-id']);
  assert.deepEqual(
    filterNewProviderModelIds(existing, ['shared-id', 'new-id'], 'openai'),
    ['new-id'],
  );
});
