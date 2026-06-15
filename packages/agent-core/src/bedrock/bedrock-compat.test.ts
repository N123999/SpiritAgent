import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bedrockReasoningConfigFromEffort,
  bedrockSupportsReasoningConfig,
} from './bedrock-compat.js';

test('bedrockSupportsReasoningConfig whitelists Anthropic, Nova, and DeepSeek R1', () => {
  assert.equal(
    bedrockSupportsReasoningConfig('anthropic.claude-3-5-sonnet-20241022-v2:0'),
    true,
  );
  assert.equal(bedrockSupportsReasoningConfig('us.amazon.nova-premier-v1:0'), true);
  assert.equal(bedrockSupportsReasoningConfig('deepseek.r1-v1:0'), true);
  assert.equal(bedrockSupportsReasoningConfig('meta.llama3-70b-instruct-v1:0'), false);
  assert.equal(bedrockSupportsReasoningConfig('openai.gpt-oss-120b'), false);
});

test('bedrockReasoningConfigFromEffort skips budgetTokens for non-whitelisted models', () => {
  assert.equal(
    bedrockReasoningConfigFromEffort('meta.llama3-70b-instruct-v1:0', 'medium'),
    undefined,
  );
  assert.deepEqual(
    bedrockReasoningConfigFromEffort('anthropic.claude-3-5-sonnet-20241022-v2:0', 'medium'),
    { type: 'enabled', budgetTokens: 4_096 },
  );
});
