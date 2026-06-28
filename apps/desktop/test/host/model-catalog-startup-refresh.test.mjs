import assert from 'node:assert/strict';
import test from 'node:test';

import { providerSupportsModelCatalogListing } from '../../dist-electron/src/host/model-catalog-metadata.js';
import {
  applyCatalogEntryToStoredModel,
  collectModelCatalogRefreshTargets,
  mergeNewCatalogModelsIntoConfig,
  modelCatalogScopeKey,
  syncExistingModelsFromCatalog,
} from '../../dist-electron/src/host/model-catalog-startup-refresh.js';

const gatewayScopeProfile = {
  name: 'anthropic/claude-sonnet-4',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  provider: 'vercel-ai-gateway',
  transportKind: 'open-responses',
  reasoningEffort: 'default',
};

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

test('syncExistingModelsFromCatalog upgrades chat-only profiles from catalog', () => {
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

  const synced = syncExistingModelsFromCatalog(
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

test('syncExistingModelsFromCatalog writes videoGeneration when capabilities are missing', () => {
  const config = {
    models: [
      {
        name: 'alibaba/wan-v2.6-t2v',
        apiBase: 'https://ai-gateway.vercel.sh/v1',
        provider: 'vercel-ai-gateway',
        transportKind: 'open-responses',
        reasoningEffort: 'default',
      },
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ['alibaba/wan-v2.6-t2v'],
    fromCache: false,
    modelCatalog: [{ id: 'alibaba/wan-v2.6-t2v', capabilities: ['videoGeneration'] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.models[0].capabilities, ['videoGeneration']);
});

test('syncExistingModelsFromCatalog corrects stale video input to videoGeneration', () => {
  const config = {
    models: [
      {
        name: 'alibaba/wan-v2.6-t2v',
        apiBase: 'https://ai-gateway.vercel.sh/v1',
        provider: 'vercel-ai-gateway',
        transportKind: 'open-responses',
        reasoningEffort: 'default',
        capabilities: ['chat', 'video'],
      },
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ['alibaba/wan-v2.6-t2v'],
    fromCache: false,
    modelCatalog: [{ id: 'alibaba/wan-v2.6-t2v', capabilities: ['videoGeneration'] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.models[0].capabilities, ['videoGeneration']);
});

test('syncExistingModelsFromCatalog syncs supportedReasoningEfforts from catalog', () => {
  const config = {
    models: [
      {
        name: 'anthropic/claude-sonnet-4',
        apiBase: 'https://ai-gateway.vercel.sh/v1',
        provider: 'vercel-ai-gateway',
        transportKind: 'open-responses',
        reasoningEffort: 'default',
        capabilities: ['chat'],
      },
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ['anthropic/claude-sonnet-4'],
    fromCache: false,
    modelCatalog: [
      {
        id: 'anthropic/claude-sonnet-4',
        capabilities: ['chat'],
        supportedReasoningEfforts: ['low', 'high'],
      },
    ],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.models[0].supportedReasoningEfforts, ['low', 'high']);
});

test('syncExistingModelsFromCatalog returns zero when catalog matches stored profile', () => {
  const config = {
    models: [
      {
        name: 'openai/gpt-4.1',
        apiBase: 'https://ai-gateway.vercel.sh/v1',
        provider: 'vercel-ai-gateway',
        transportKind: 'open-responses',
        reasoningEffort: 'default',
        capabilities: ['chat'],
        supportedReasoningEfforts: ['low', 'high'],
        contextLength: 128000,
      },
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ['openai/gpt-4.1'],
    fromCache: false,
    modelCatalog: [
      {
        id: 'openai/gpt-4.1',
        capabilities: ['chat'],
        supportedReasoningEfforts: ['low', 'high'],
        contextLength: 256000,
      },
    ],
  });

  assert.equal(synced, 0);
  assert.equal(config.models[0].contextLength, 128000);
});

test('applyCatalogEntryToStoredModel backfills contextLength only when unset', () => {
  const model = {
    name: 'openai/gpt-4.1',
    apiBase: 'https://ai-gateway.vercel.sh/v1',
    reasoningEffort: 'default',
  };

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: 'openai/gpt-4.1',
      contextLength: 128000,
    }),
    true,
  );
  assert.equal(model.contextLength, 128000);

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: 'openai/gpt-4.1',
      contextLength: 256000,
    }),
    false,
  );
  assert.equal(model.contextLength, 128000);
});
