import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSiliconFlowVideoImageSize } from './siliconflow-backend.js';
import { isSiliconFlowApiBase, resolveVideoGenerationBackend } from './router.js';

test('mapSiliconFlowVideoImageSize maps aspect ratios to provider enums', () => {
  assert.equal(mapSiliconFlowVideoImageSize('16:9'), '1280x720');
  assert.equal(mapSiliconFlowVideoImageSize('9:16'), '720x1280');
  assert.equal(mapSiliconFlowVideoImageSize('1:1'), '960x960');
  assert.equal(mapSiliconFlowVideoImageSize(undefined), '1280x720');
});

test('resolveVideoGenerationBackend routes siliconflow vendor and api base', () => {
  assert.equal(
    resolveVideoGenerationBackend({
      apiKey: 'test-key',
      model: 'Wan-AI/Wan2.2-T2V-A14B',
      llmVendor: 'siliconflow',
      baseUrl: 'https://api.siliconflow.com/v1',
    }).id,
    'siliconflow',
  );
  assert.equal(isSiliconFlowApiBase('https://api.siliconflow.cn/v1'), true);
});
