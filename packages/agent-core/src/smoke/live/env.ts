import type { OpenAiLlmVendor, OpenAiTransportConfig } from '../../openai/openai-compat.js';

import { requireEnv } from '../shared/env.js';

export const LIVE_SMOKE_GATE_ENV = 'SPIRIT_AGENT_ALLOW_LIVE_SMOKE';

const OPENAI_LLM_VENDOR_ENV = 'OPENAI_LLM_VENDOR';
const LIVE_SMOKE_VENDOR_VALUES = new Set<OpenAiLlmVendor>([
  'deepseek',
  'kimi',
  'minimax',
  'alibaba',
  'custom',
]);

export function shouldRunLiveSmoke(): boolean {
  if (process.env[LIVE_SMOKE_GATE_ENV] === '1') {
    return true;
  }

  console.log(`${LIVE_SMOKE_GATE_ENV}=1 未设置，跳过 live smoke。`);
  return false;
}

export function createLiveOpenAiCompatibleSmokeConfig(): OpenAiTransportConfig {
  const apiKey = requireEnv('OPENAI_API_KEY', 'SPIRIT_API_KEY');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
  const baseUrl = process.env.OPENAI_BASE_URL ?? process.env.SPIRIT_API_BASE;
  const llmVendor = parseLiveSmokeVendor(process.env[OPENAI_LLM_VENDOR_ENV]);

  return {
    apiKey,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    ...(llmVendor ? { llmVendor } : {}),
  };
}

function parseLiveSmokeVendor(value: string | undefined): OpenAiLlmVendor | undefined {
  if (!value || !value.trim()) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!LIVE_SMOKE_VENDOR_VALUES.has(normalized as OpenAiLlmVendor)) {
    throw new Error(
      `${OPENAI_LLM_VENDOR_ENV} 仅支持 ${Array.from(LIVE_SMOKE_VENDOR_VALUES).join(', ')}，实际为 ${value}`,
    );
  }

  return normalized as OpenAiLlmVendor;
}
