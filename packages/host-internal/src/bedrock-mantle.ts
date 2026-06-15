/** Renderer-safe Bedrock Mantle（OpenAI GPT-5.x frontier）helpers。 */

import { normalizeAwsRegion } from './bedrock-region.js';

/** Bedrock Mantle OpenAI 模型 ID（含 frontier 与 OSS，如 `openai.gpt-5.5`、`openai.gpt-oss-120b`）。 */
export function isBedrockMantleOpenAiModel(modelId: string): boolean {
  return /^openai\.gpt-/i.test(modelId.trim());
}

export function bedrockMantleApiBaseFromRegion(region: string): string {
  const normalized = normalizeAwsRegion(region);
  if (!normalized) {
    return 'https://bedrock-mantle.us-east-1.api.aws/openai/v1';
  }
  return `https://bedrock-mantle.${normalized}.api.aws/openai/v1`;
}
