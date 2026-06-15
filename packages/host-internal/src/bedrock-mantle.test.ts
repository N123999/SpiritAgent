import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
} from './bedrock-mantle.js';

test('isBedrockMantleOpenAiModel detects openai.gpt frontier ids', () => {
  assert.equal(isBedrockMantleOpenAiModel('openai.gpt-5.5'), true);
  assert.equal(isBedrockMantleOpenAiModel('OpenAI.GPT-5.4'), true);
  assert.equal(isBedrockMantleOpenAiModel('anthropic.claude-3-5-sonnet-20241022-v2:0'), false);
});

test('isBedrockMantleOpenAiModel includes openai.gpt-oss models on Mantle', () => {
  assert.equal(isBedrockMantleOpenAiModel('openai.gpt-oss-120b'), true);
  assert.equal(isBedrockMantleOpenAiModel('openai.gpt-oss-20b'), true);
});

test('bedrockMantleApiBaseFromRegion uses bedrock-mantle /openai/v1 base', () => {
  assert.equal(
    bedrockMantleApiBaseFromRegion('us-east-2'),
    'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
  );
  assert.equal(
    bedrockMantleApiBaseFromRegion('  US-EAST-1  '),
    'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
  );
});
