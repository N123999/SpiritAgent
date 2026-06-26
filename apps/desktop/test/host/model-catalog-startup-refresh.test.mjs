import assert from 'node:assert/strict';
import test from 'node:test';

import { providerSupportsModelCatalogListing } from '../../dist-electron/src/host/model-catalog-metadata.js';
import {
  collectModelCatalogRefreshTargets,
  mergeNewCatalogModelsIntoConfig,
  modelCatalogScopeKey,
  syncExistingModelCapabilitiesFromCatalog,
} from '../../dist-electron/src/host/model-catalog-startup-refresh.js';

test('providerSupportsModelCatalogListing includes OpenAI and excludes Azure', () => {
  assert.equal(
    providerSupportsModelCatalogListing({ provider: 'openai', transportKind: 'open-responses' }),
    true,
  );
  assert.equal(
    providerSupportsModelCatalogListing({ provider: 'azure', transportKind: 'open-responses' }),
    false,
  );
});

test('collectModelCatalogRefreshTargets skips Azure and includes OpenAI', () => {
  const targets = collectModelCatalogRefreshTargets([
    { name: 'gpt-4.1', apiBase: 'https://api.openai.com/v1', provider: 'openai' },
    { name: 'my-deploy', apiBase: 'https://x.openai.azure.com/openai/v1', provider: 'azure' },
    { name: 'local', apiBase: 'http://127.0.0.1:8080/v1', provider: 'custom', transportKind: 'bedrock' },
    {
      name: 'anthropic/claude-sonnet-4',
      apiBase: 'https://ai-gateway.vercel.sh/v1',
      provider: 'vercel-ai-gateway',
      transportKind: 'open-responses',
    },
  ]);

  assert.equal(targets.length, 2);
  assert.deepEqual(
    targets.map((target) => target.provider).sort(),
    ['openai', 'vercel-ai-gateway'],
  );
});

test('collectModelCatalogRefreshTargets dedupes by provider transport and api base', () => {
  const shared = {
    apiBase: 'https://ai-gateway.vercel.sh/v1',
    provider: 'vercel-ai-gateway',
    transportKind: 'open-responses',
  };
  const targets = collectModelCatalogRefreshTargets([
    { name: 'anthropic/claude-sonnet-4', ...shared },
    { name: 'openai/gpt-4.1', ...shared },
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.name, 'anthropic/claude-sonnet-4');
});

test('modelCatalogScopeKey normalizes api base', () => {
  const key = modelCatalogScopeKey({
    provider: 'vercel-ai-gateway',
    transportKind: 'open-responses',
    apiBase: 'https://ai-gateway.vercel.sh/v1/',
  });
  assert.equal(key, 'vercel-ai-gateway::open-responses::https://ai-gateway.vercel.sh/v1');
});

test('mergeNewCatalogModelsIntoConfig appends only new provider-scoped models', () => {
  const config = {
    models: [
      {
        name: 'zai/glm-5.1',
        apiBase: 'https://ai-gateway.vercel.sh/v1',
        provider: 'vercel-ai-gateway',
        transportKind: 'open-responses',
        reasoningEffort: 'default',
      },
    ],
    activeModel: 'zai/glm-5.1',
  };

  const merged = mergeNewCatalogModelsIntoConfig(
    config,
    config.models[0],
    {
      modelIds: ['zai/glm-5.1', 'zai/glm-5.2'],
      fromCache: false,
      modelCatalog: [
        { id: 'zai/glm-5.1', capabilities: ['chat'] },
        { id: 'zai/glm-5.2', capabilities: ['chat'] },
      ],
    },
  );

  assert.equal(merged, 1);
  assert.deepEqual(
    config.models.map((model) => model.name),
    ['zai/glm-5.1', 'zai/glm-5.2'],
  );
  assert.equal(config.activeModel, 'zai/glm-5.1');
});

test('syncExistingModelCapabilitiesFromCatalog upgrades chat-only profiles from catalog', () => {
  const config = {
    models: [
      {
        name: 'MiniMax-M3',
        apiBase: 'https://api.minimaxi.com/v1',
        provider: 'minimax',
        capabilities: ['chat'],
        reasoningEffort: 'medium',
      },
      {
        name: 'MiniMax-M2.5',
        apiBase: 'https://api.minimaxi.com/v1',
        provider: 'minimax',
        capabilities: ['chat'],
        reasoningEffort: 'medium',
      },
    ],
    activeModel: 'MiniMax-M3',
  };

  const synced = syncExistingModelCapabilitiesFromCatalog(
    config,
    config.models[0],
    {
      modelIds: ['MiniMax-M3', 'MiniMax-M2.5'],
      fromCache: false,
      modelCatalog: [
        { id: 'MiniMax-M3', capabilities: ['chat', 'image', 'video'] },
        { id: 'MiniMax-M2.5', capabilities: ['chat'] },
      ],
    },
  );

  assert.equal(synced, 1);
  assert.deepEqual(config.models[0].capabilities, ['chat', 'image', 'video']);
  assert.deepEqual(config.models[1].capabilities, ['chat']);
});
