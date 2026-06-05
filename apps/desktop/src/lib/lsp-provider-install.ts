import type { DesktopLspProviderSnapshot } from '@/types';

export function isDesktopInstallableProvider(provider: DesktopLspProviderSnapshot): boolean {
  return provider.installKind === 'npm' || provider.installKind === 'go' || provider.installKind === 'rustup';
}
