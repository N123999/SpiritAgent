import assert from 'node:assert/strict';
import test from 'node:test';

import {
  modelsDevProviderLogoId,
  modelsDevProviderLogoUrl,
} from '../../src/lib/models-dev-provider-logo.ts';

test('modelsDevProviderLogoId maps Spirit ids to models.dev provider folders', () => {
  assert.equal(modelsDevProviderLogoId('vercel-ai-gateway'), 'vercel');
  assert.equal(modelsDevProviderLogoId('moonshot-ai'), 'moonshotai');
  assert.equal(modelsDevProviderLogoId('z-ai'), 'zai');
  assert.equal(modelsDevProviderLogoId('zhipu-ai'), 'zhipuai');
  assert.equal(modelsDevProviderLogoId('openai'), 'openai');
  assert.equal(modelsDevProviderLogoId('google-vertex-ai'), 'google-vertex');
});

test('modelsDevProviderLogoUrl uses aliased provider id', () => {
  assert.equal(
    modelsDevProviderLogoUrl('vercel-ai-gateway'),
    'https://models.dev/logos/vercel.svg',
  );
  assert.equal(
    modelsDevProviderLogoUrl('z-ai'),
    'https://models.dev/logos/zai.svg',
  );
  assert.equal(
    modelsDevProviderLogoUrl('zhipu-ai'),
    'https://models.dev/logos/zhipuai.svg',
  );
});
