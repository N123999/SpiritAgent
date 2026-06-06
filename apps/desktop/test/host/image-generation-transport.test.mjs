import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOpenAiCompatibleTransportConfig } from '@spirit-agent/core';

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
