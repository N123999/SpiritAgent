import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOpenAiGptModelAtLeast51,
  buildApplyPatchFileToolsPromptSection,
  normalizeGatewayOpenAiModelId,
  shouldUseApplyPatchFileTools,
} from './apply-patch-eligibility.js';

test('isOpenAiGptModelAtLeast51 boundaries', () => {
  assert.equal(isOpenAiGptModelAtLeast51('gpt-5.1'), true);
  assert.equal(isOpenAiGptModelAtLeast51('gpt-5.4'), true);
  assert.equal(isOpenAiGptModelAtLeast51('GPT-5.2-preview'), true);
  assert.equal(isOpenAiGptModelAtLeast51('gpt-6'), true);
  assert.equal(isOpenAiGptModelAtLeast51('gpt-5'), false);
  assert.equal(isOpenAiGptModelAtLeast51('gpt-5-mini'), false);
  assert.equal(isOpenAiGptModelAtLeast51('gpt-4.1'), false);
  assert.equal(isOpenAiGptModelAtLeast51('claude-sonnet-4'), false);
});

test('normalizeGatewayOpenAiModelId', () => {
  assert.equal(normalizeGatewayOpenAiModelId('openai/gpt-5.1'), 'gpt-5.1');
  assert.equal(normalizeGatewayOpenAiModelId('openai/gpt-5.4'), 'gpt-5.4');
  assert.equal(normalizeGatewayOpenAiModelId('anthropic/claude-sonnet-4'), undefined);
  assert.equal(normalizeGatewayOpenAiModelId('gpt-5.1'), undefined);
});

test('shouldUseApplyPatchFileTools openai official', () => {
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'openai',
      responsesProvider: 'openai',
      model: 'gpt-5.1',
    }),
    true,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'openai',
      responsesProvider: 'openai',
      model: 'gpt-5',
    }),
    false,
  );
});

test('shouldUseApplyPatchFileTools vercel gateway', () => {
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'vercel-ai-gateway',
      responsesProvider: 'open-responses-compatible',
      model: 'openai/gpt-5.1',
    }),
    true,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'vercel-ai-gateway',
      responsesProvider: 'open-responses-compatible',
      model: 'openai/gpt-5',
    }),
    false,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'vercel-ai-gateway',
      responsesProvider: 'open-responses-compatible',
      model: 'anthropic/claude-sonnet-4',
    }),
    false,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'vercel-ai-gateway',
      responsesProvider: 'open-responses-compatible',
      model: 'gpt-5.1',
    }),
    false,
  );
});

test('shouldUseApplyPatchFileTools rejects other vendors', () => {
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'open-responses',
      llmVendor: 'xai',
      responsesProvider: 'xai',
      model: 'gpt-5.1',
    }),
    false,
  );
  assert.equal(
    shouldUseApplyPatchFileTools({
      transportKind: 'openai-compatible',
      llmVendor: 'openai',
      model: 'gpt-5.1',
    } as any),
    false,
  );
});

test('buildApplyPatchFileToolsPromptSection mentions apply_patch and V4A', () => {
  const section = buildApplyPatchFileToolsPromptSection();
  assert.match(section, /apply_patch/);
  assert.match(section, /V4A/);
  assert.match(section, /create_file/);
});
