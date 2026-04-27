import type { DesktopModelProvider } from '../types.js';

/** 与 `storage.ts` 默认根地址一致（仅作自定义端点留空时的占位）。 */
export const DEFAULT_CUSTOM_API_BASE = 'https://api.openai.com/v1';

/** 各厂商 OpenAI 兼容根路径（均以 `/v1` 结尾）。 */
export const PROVIDER_PRESET_API_BASE: Record<
  Exclude<DesktopModelProvider, 'custom'>,
  string
> = {
  // https://api-docs.deepseek.com
  deepseek: 'https://api.deepseek.com/v1',
  // https://platform.moonshot.cn/docs/api/chat
  kimi: 'https://api.moonshot.cn/v1',
  // 中国区 OpenAI 兼容：https://platform.minimaxi.com/docs/api-reference/text-openai-api
  minimax: 'https://api.minimaxi.com/v1',
};

export const PROVIDER_PICKER_ROWS: Array<{
  id: DesktopModelProvider;
  label: string;
}> = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'minimax', label: 'MiniMax' },
  { id: 'custom', label: '自定义' },
];

export function resolveConnectApiBase(
  provider: DesktopModelProvider,
  customApiBaseTrimmed: string,
): string {
  if (provider === 'deepseek') {
    return PROVIDER_PRESET_API_BASE.deepseek;
  }
  if (provider === 'kimi') {
    return PROVIDER_PRESET_API_BASE.kimi;
  }
  if (provider === 'minimax') {
    return PROVIDER_PRESET_API_BASE.minimax;
  }
  const trimmed = customApiBaseTrimmed.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_CUSTOM_API_BASE;
}
