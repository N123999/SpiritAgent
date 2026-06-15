import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AiSdkOpenResponsesTransport,
  createLlmTransport,
  isOpenAiCompatibleTransportConfig,
} from '@spirit-agent/core';

test('deepseek primary transport without transportKind must still count as openai-compatible', () => {
  const runtimeTransportConfig = {
    apiKey: 'chat-key',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    llmVendor: 'deepseek',
  };

  assert.equal(runtimeTransportConfig.transportKind, undefined);
  assert.equal(runtimeTransportConfig.transportKind === 'openai-compatible', false);
  assert.equal(isOpenAiCompatibleTransportConfig(runtimeTransportConfig), true);
});

test('open-responses transport exposes generateImage when imageGeneration sub-config is present', () => {
  const transport = createLlmTransport({
    transportKind: 'open-responses',
    apiKey: 'chat-key',
    model: 'openai/gpt-image-2',
    baseUrl: 'https://gateway.example.com/v1',
    imageGeneration: {
      apiKey: 'image-key',
      model: 'openai/gpt-image-2',
      baseUrl: 'https://gateway.example.com/v1',
    },
  });

  assert.equal(transport.constructor.name, 'AiSdkOpenResponsesTransport');
  assert.equal(typeof transport.generateImage, 'function');
  assert.equal(typeof new AiSdkOpenResponsesTransport().generateImage, 'function');
});
