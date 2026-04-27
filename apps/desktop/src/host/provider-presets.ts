/** 薄封装：预设提供商数据来自 `@spirit-agent/host-internal`，避免 Desktop 与 CLI 分叉。 */
export {
  DEFAULT_CUSTOM_API_BASE,
  MODEL_PROVIDER_PICKER_ORDER,
  PROVIDER_PRESET_API_BASE,
  PROVIDER_PICKER_ROWS,
  resolveConnectApiBase,
} from '@spirit-agent/host-internal';
export type { ModelProviderId } from '@spirit-agent/host-internal';
