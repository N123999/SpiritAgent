import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  previewCatalogMapForTransport,
  previewModelCatalogForTransport,
  usesAnthropicModelCatalogMetadata,
} from '../../dist-electron/src/host/model-catalog-metadata.js';

test('custom anthropic transport consumes Anthropic model catalog metadata', () => {
  assert.equal(
    usesAnthropicModelCatalogMetadata({ provider: 'custom', transportKind: 'anthropic' }),
    true,
  );

  const preview = previewModelCatalogForTransport({
    provider: 'custom',
    transportKind: 'anthropic',
    listedModels: [
      {
        id: 'claude-sonnet-4-20250514',
        supportsVision: false,
        supportedReasoningEfforts: ['low', 'high', 'high', 'default', 'max'],
      },
    ],
  });

  assert.deepEqual(preview, [
    {
      id: 'claude-sonnet-4-20250514',
      capabilities: ['chat'],
      supportedReasoningEfforts: ['low', 'high', 'max'],
    },
  ]);

  const catalogMap = previewCatalogMapForTransport({
    provider: 'custom',
    transportKind: 'anthropic',
    modelCatalog: preview,
  });

  assert.deepEqual(catalogMap.get('claude-sonnet-4-20250514'), preview[0]);
});

test('openai-compatible transport does not treat metadata as Anthropic-specific catalog data', () => {
  assert.equal(
    usesAnthropicModelCatalogMetadata({ provider: 'custom', transportKind: 'openai-compatible' }),
    false,
  );

  assert.equal(
    previewModelCatalogForTransport({
      provider: 'custom',
      transportKind: 'openai-compatible',
      listedModels: [{ id: 'some-model', supportsVision: true, supportedReasoningEfforts: ['low'] }],
    }),
    undefined,
  );

  assert.equal(
    previewCatalogMapForTransport({
      provider: 'custom',
      transportKind: 'openai-compatible',
      modelCatalog: [{ id: 'some-model', capabilities: ['chat', 'vision'] }],
    }).size,
    0,
  );
});