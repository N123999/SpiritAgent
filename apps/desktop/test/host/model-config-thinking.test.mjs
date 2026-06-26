import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPrimaryTransportConfig } from '../../dist-electron/src/host/model-config.js';

test('buildPrimaryTransportConfig wires DeepSeek V4 thinking on with high effort', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'deepseek',
      transportKind: 'openai-compatible',
      reasoningEffort: 'high',
      capabilities: ['chat'],
    },
  });
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, 'high');
});

test('buildPrimaryTransportConfig disables DeepSeek V4 thinking and strips effort', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'deepseek',
      transportKind: 'openai-compatible',
      reasoningEffort: 'high',
      thinkingEnabled: false,
      capabilities: ['chat'],
    },
  });
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, undefined);
});

test('buildPrimaryTransportConfig wires Z.ai effort when thinking enabled', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'glm-4.7',
    baseUrl: 'https://api.z.ai/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'z-ai',
      transportKind: 'openai-compatible',
      reasoningEffort: 'medium',
      capabilities: ['chat'],
    },
  });
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, 'medium');
});

test('buildPrimaryTransportConfig disables Alibaba thinking when thinkingEnabled false', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'alibaba',
      transportKind: 'openai-compatible',
      reasoningEffort: 'default',
      thinkingEnabled: false,
      capabilities: ['chat'],
    },
  });
  assert.equal(config.vendorExtendedThinking, false);
});

test('buildPrimaryTransportConfig wires Gateway Claude budget thinking off via vendorExtendedThinking', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'anthropic/claude-opus-4-5',
    baseUrl: 'https://gateway.ai.vercel.com/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'vercel-ai-gateway',
      transportKind: 'open-responses',
      reasoningEffort: 'medium',
      thinkingEnabled: false,
      capabilities: ['chat'],
    },
  });
  assert.equal(config.transportKind, 'open-responses');
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, 'medium');
});

test('buildPrimaryTransportConfig wires Gateway Claude adaptive thinking off via vendorExtendedThinking', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'anthropic/claude-opus-4-8',
    baseUrl: 'https://gateway.ai.vercel.com/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'vercel-ai-gateway',
      transportKind: 'open-responses',
      reasoningEffort: 'high',
      thinkingEnabled: false,
      capabilities: ['chat'],
    },
  });
  assert.equal(config.transportKind, 'open-responses');
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.reasoningEffort, 'high');
});

test('buildPrimaryTransportConfig wires Gateway Claude adaptive thinking on with effort', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'test-key',
    model: 'anthropic/claude-opus-4-8',
    baseUrl: 'https://gateway.ai.vercel.com/v1',
    workspaceRoot: '/tmp',
    profile: {
      provider: 'vercel-ai-gateway',
      transportKind: 'open-responses',
      reasoningEffort: 'high',
      capabilities: ['chat'],
    },
  });
  assert.equal(config.transportKind, 'open-responses');
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, 'high');
});
