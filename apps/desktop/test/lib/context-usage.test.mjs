import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseModelContextLength } from '../../src/lib/model-context-length.ts';
import {
  buildContextUsagePercent,
  normalizeContextUsageSnapshot,
  resolveModelContextLength,
} from '../../src/lib/context-usage.ts';

test('parseModelContextLength accepts positive integers only', () => {
  assert.equal(parseModelContextLength(128000), 128000);
  assert.equal(parseModelContextLength(0), undefined);
  assert.equal(parseModelContextLength(-1), undefined);
  assert.equal(parseModelContextLength(1.5), undefined);
  assert.equal(parseModelContextLength('128000'), undefined);
});

test('resolveModelContextLength prefers profile contextLength over catalog', () => {
  const activeModel = {
    name: 'my-model',
    apiBase: 'https://example.invalid/v1',
    provider: 'custom',
    contextLength: 200000,
  };
  const catalogHints = [
    {
      provider: 'vercel-ai-gateway',
      transportKind: 'openai-compatible',
      apiBase: 'https://gateway.example/v1',
      modelIds: ['openai/gpt-5'],
      modelCatalog: [{ id: 'openai/gpt-5', contextLength: 999999 }],
      fetchedAtUnixMs: 1,
    },
  ];

  assert.equal(resolveModelContextLength(activeModel, catalogHints), 200000);
});

test('resolveModelContextLength uses catalog for gateway when profile has no override', () => {
  const activeModel = {
    name: 'openai/gpt-5',
    apiBase: 'https://gateway.example/v1',
    provider: 'vercel-ai-gateway',
    transportKind: 'openai-compatible',
  };
  const catalogHints = [
    {
      provider: 'vercel-ai-gateway',
      transportKind: 'openai-compatible',
      apiBase: 'https://gateway.example/v1',
      modelIds: ['openai/gpt-5'],
      modelCatalog: [{ id: 'openai/gpt-5', contextLength: 128000 }],
      fetchedAtUnixMs: 1,
    },
  ];

  assert.equal(resolveModelContextLength(activeModel, catalogHints), 128000);
});

test('resolveModelContextLength uses catalog for moonshot-ai when profile has no override', () => {
  const activeModel = {
    name: 'kimi-k2.5',
    apiBase: 'https://api.moonshot.cn/v1',
    provider: 'moonshot-ai',
    transportKind: 'openai-compatible',
  };
  const catalogHints = [
    {
      provider: 'moonshot-ai',
      transportKind: 'openai-compatible',
      apiBase: 'https://api.moonshot.cn/v1',
      modelIds: ['kimi-k2.5'],
      modelCatalog: [{ id: 'kimi-k2.5', contextLength: 256000 }],
      fetchedAtUnixMs: 1,
    },
  ];

  assert.equal(resolveModelContextLength(activeModel, catalogHints), 256000);
});

test('resolveModelContextLength returns undefined for custom without profile override', () => {
  const activeModel = {
    name: 'my-model',
    apiBase: 'https://example.invalid/v1',
    provider: 'custom',
  };

  assert.equal(resolveModelContextLength(activeModel, []), undefined);
});

test('normalizeContextUsageSnapshot accepts valid snapshots and recomputes percent', () => {
  assert.deepEqual(
    normalizeContextUsageSnapshot({ inputTokens: 1200, contextLength: 128000, percent: 1 }),
    { inputTokens: 1200, contextLength: 128000, percent: 1 },
  );
  assert.deepEqual(
    normalizeContextUsageSnapshot({ inputTokens: 64000, contextLength: 128000 }),
    { inputTokens: 64000, contextLength: 128000, percent: buildContextUsagePercent(64000, 128000) },
  );
  assert.equal(normalizeContextUsageSnapshot(null), undefined);
  assert.equal(normalizeContextUsageSnapshot({ inputTokens: -1, contextLength: 128000 }), undefined);
  assert.equal(normalizeContextUsageSnapshot({ inputTokens: 1, contextLength: 0 }), undefined);
});
