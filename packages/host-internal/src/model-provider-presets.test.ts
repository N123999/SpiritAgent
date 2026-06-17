import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultProviderConnectSite,
  listProviderConnectSiteOptions,
  parseModelProviderId,
  parsePresetModelProviderId,
  parseProviderSiteSelection,
  partitionModelsByProvider,
  providerSupportsSiteSelection,
  resolveProviderConnectApiBase,
  resolveProviderConnectSiteApiBase,
} from './model-provider-presets.js';

test('parse model provider helpers accept canonical ids and reject invalid values', () => {
  assert.equal(parseModelProviderId('alibaba'), 'alibaba');
  assert.equal(parseModelProviderId('vercel-ai-gateway'), 'vercel-ai-gateway');
  assert.equal(parseModelProviderId('openrouter'), 'openrouter');
  assert.equal(parseModelProviderId('openai'), 'openai');
  assert.equal(parseModelProviderId('google'), 'google');
  assert.equal(parseModelProviderId('xai'), 'xai');
  assert.equal(parseModelProviderId('custom'), 'custom');
  assert.equal(parseModelProviderId('moonshot-ai'), 'moonshot-ai');
  assert.equal(parseModelProviderId('z-ai'), 'z-ai');
  assert.equal(parseModelProviderId('zhipu-ai'), 'zhipu-ai');
  assert.equal(parseModelProviderId('xiaomi'), 'xiaomi');
  assert.equal(parseModelProviderId('siliconflow'), 'siliconflow');
  assert.equal(parseModelProviderId('azure'), 'azure');
  assert.equal(parseModelProviderId('kimi'), undefined);
  assert.equal(parseModelProviderId('unknown'), undefined);
  assert.equal(parseModelProviderId(''), undefined);

  assert.equal(parsePresetModelProviderId('alibaba'), 'alibaba');
  assert.equal(parsePresetModelProviderId('xai'), 'xai');
  assert.equal(parsePresetModelProviderId('custom'), undefined);
  assert.equal(parsePresetModelProviderId('unknown'), undefined);
});

test('partition models by provider preserves ordering and separates unmatched entries', () => {
  const models = [
    { name: 'qwen3.6-plus', provider: 'alibaba' as const },
    { name: 'deepseek-v4-pro', provider: 'deepseek' as const },
    { name: 'qwen3.6-max-preview', provider: 'alibaba' as const },
    { name: 'custom-model', provider: 'custom' as const },
    { name: 'legacy-openai' },
  ];

  assert.deepEqual(partitionModelsByProvider(models, 'alibaba'), {
    matched: [models[0], models[2]],
    unmatched: [models[1], models[3], models[4]],
  });
});

test('resolveProviderConnectApiBase uses transport-specific preset bases', () => {
  assert.equal(
    resolveProviderConnectApiBase('xai', 'openai-compatible'),
    'https://api.x.ai/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('xai', 'open-responses'),
    'https://api.x.ai/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('minimax', 'anthropic'),
    'https://api.minimaxi.com/anthropic/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('deepseek', 'anthropic'),
    'https://api.deepseek.com/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('xiaomi', 'openai-compatible'),
    'https://api.xiaomimimo.com/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('xiaomi', 'anthropic'),
    'https://api.xiaomimimo.com/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'openai-compatible'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'open-responses'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('alibaba', 'anthropic'),
    'https://dashscope.aliyuncs.com/apps/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('openai', 'open-responses'),
    'https://api.openai.com/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('google', 'openai-compatible'),
    'https://generativelanguage.googleapis.com/v1beta',
  );
  assert.equal(
    resolveProviderConnectApiBase('azure', 'open-responses'),
    'https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1',
  );
});

test('resolveProviderConnectApiBase returns OpenRouter preset base', () => {
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'openai-compatible'),
    'https://openrouter.ai/api/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'open-responses'),
    'https://openrouter.ai/api/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('openrouter', 'anthropic'),
    'https://openrouter.ai/api/v1',
  );
});

test('resolveProviderConnectApiBase returns Z.ai preset base', () => {
  assert.equal(
    resolveProviderConnectApiBase('z-ai', 'openai-compatible'),
    'https://api.z.ai/api/paas/v4',
  );
});

test('resolveProviderConnectApiBase returns Zhipu AI preset base', () => {
  assert.equal(
    resolveProviderConnectApiBase('zhipu-ai', 'openai-compatible'),
    'https://open.bigmodel.cn/api/paas/v4',
  );
});

test('resolveProviderConnectApiBase ignores endpoint override for preset providers', () => {
  assert.equal(
    resolveProviderConnectApiBase('deepseek', 'anthropic', 'https://custom.example/v1'),
    'https://api.deepseek.com/anthropic',
  );
  assert.equal(
    resolveProviderConnectApiBase('google', 'openai-compatible', 'https://api.openai.com/v1'),
    'https://generativelanguage.googleapis.com/v1beta',
  );
});

test('resolveProviderConnectApiBase accepts override only for custom provider', () => {
  assert.equal(
    resolveProviderConnectApiBase('custom', 'openai-compatible', 'https://custom.example/v1'),
    'https://custom.example/v1',
  );
});

test('parseProviderSiteSelection validates site definitions', () => {
  const parsed = parseProviderSiteSelection({
    xiaomi: {
      defaultSite: 'cn',
      sites: {
        cn: {
          labelKey: 'providers.test.site.cn',
          fallbackLabel: 'China',
          apiBase: 'https://api.example.cn/v1',
        },
        intl: {
          labelKey: 'providers.test.site.intl',
          fallbackLabel: 'International',
          apiBase: 'https://api.example.com/v1',
        },
      },
    },
  });

  assert.equal(parsed.xiaomi?.defaultSite, 'cn');
  assert.equal(parsed.xiaomi?.sites.cn?.apiBase, 'https://api.example.cn/v1');
  assert.deepEqual(parseProviderSiteSelection({}), {});
});

test('parseProviderSiteSelection rejects invalid defaultSite', () => {
  assert.throws(
    () =>
      parseProviderSiteSelection({
        xiaomi: {
          defaultSite: 'missing',
          sites: {
            cn: {
              labelKey: 'providers.test.site.cn',
              fallbackLabel: 'China',
              apiBase: 'https://api.example.cn/v1',
            },
          },
        },
      }),
    /defaultSite must exist in sites/,
  );
});

test('provider site helpers are inactive until providerSiteSelection is configured', () => {
  assert.equal(providerSupportsSiteSelection('xiaomi'), false);
  assert.equal(defaultProviderConnectSite('xiaomi'), undefined);
  assert.deepEqual(listProviderConnectSiteOptions('xiaomi'), []);
  assert.equal(resolveProviderConnectSiteApiBase('xiaomi', 'cn'), undefined);
});

test('resolveProviderConnectApiBase prefers site apiBase for siliconflow', () => {
  assert.equal(providerSupportsSiteSelection('siliconflow'), true);
  assert.equal(defaultProviderConnectSite('siliconflow'), 'intl');
  assert.equal(
    resolveProviderConnectApiBase('siliconflow', 'openai-compatible', { site: 'cn' }),
    'https://api.siliconflow.cn/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('siliconflow', 'anthropic', { site: 'intl' }),
    'https://api.siliconflow.com/v1',
  );
  assert.equal(
    resolveProviderConnectApiBase('siliconflow', 'openai-compatible'),
    'https://api.siliconflow.com/v1',
  );
});
