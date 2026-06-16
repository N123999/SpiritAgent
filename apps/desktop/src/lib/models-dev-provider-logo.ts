import type { DesktopModelProvider } from '@/types';

const MODELS_DEV_LOGO_ORIGIN = 'https://models.dev';

/**
 * Spirit `ModelProviderId` → models.dev provider folder id.
 * models.dev 对未知 id 会回默认 sparkles SVG，而非 404。
 */
const MODELS_DEV_LOGO_ID_ALIASES: Partial<Record<DesktopModelProvider, string>> = {
  'vercel-ai-gateway': 'vercel',
  'moonshot-ai': 'moonshotai',
  'google-vertex-ai': 'google-vertex',
};

export function modelsDevProviderLogoId(providerId: DesktopModelProvider): string {
  return MODELS_DEV_LOGO_ID_ALIASES[providerId] ?? providerId;
}

/** models.dev CDN logo URL. */
export function modelsDevProviderLogoUrl(providerId: DesktopModelProvider): string {
  return `${MODELS_DEV_LOGO_ORIGIN}/logos/${encodeURIComponent(modelsDevProviderLogoId(providerId))}.svg`;
}
