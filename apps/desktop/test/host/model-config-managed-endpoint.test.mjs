import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPrimaryTransportConfig,
  resolveDesktopTransportKind,
  resolveProfileApiBase,
} from '../../dist-electron/src/host/model-config.js';

test('resolveProfileApiBase uses preset endpoint for google provider profiles', () => {
  assert.equal(
    resolveProfileApiBase({
      provider: 'google',
      transportKind: 'openai-compatible',
      apiBase: 'https://api.openai.com/v1',
    }),
    'https://generativelanguage.googleapis.com/v1beta',
  );
});

test('resolveProfileApiBase keeps custom provider apiBase override', () => {
  assert.equal(
    resolveProfileApiBase({
      provider: 'custom',
      transportKind: 'openai-compatible',
      apiBase: 'https://custom.example/v1',
    }),
    'https://custom.example/v1',
  );
});

test('resolveDesktopTransportKind downgrades google open-responses to openai-compatible', () => {
  assert.equal(
    resolveDesktopTransportKind({
      provider: 'google',
      transportKind: 'open-responses',
    }),
    'openai-compatible',
  );
});

test('resolveProfileApiBase routes Bedrock mantle OpenAI models to bedrock-mantle endpoint', () => {
  assert.equal(
    resolveProfileApiBase({
      name: 'openai.gpt-5.5',
      provider: 'amazon-bedrock',
      transportKind: 'bedrock',
      apiBase: '',
      awsRegion: 'us-east-2',
    }),
    'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
  );
  assert.equal(
    resolveProfileApiBase({
      name: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      provider: 'amazon-bedrock',
      transportKind: 'bedrock',
      apiBase: '',
      awsRegion: 'us-east-1',
    }),
    'https://bedrock.us-east-1.amazonaws.com',
  );
});

test('buildPrimaryTransportConfig routes Bedrock mantle models to open-responses transport', () => {
  const config = buildPrimaryTransportConfig({
    apiKey: 'bedrock-bearer-key',
    model: 'openai.gpt-5.5',
    baseUrl: 'https://bedrock.us-east-1.amazonaws.com',
    workspaceRoot: '/tmp/workspace',
    profile: {
      provider: 'amazon-bedrock',
      transportKind: 'bedrock',
      awsRegion: 'us-east-2',
      reasoningEffort: 'medium',
    },
  });

  assert.equal(config.transportKind, 'open-responses');
  assert.equal(config.baseUrl, 'https://bedrock-mantle.us-east-2.api.aws/openai/v1');
  assert.equal(config.model, 'openai.gpt-5.5');
  assert.equal(config.responsesProvider, 'openai');
  assert.equal(config.llmVendor, 'openai');
});
