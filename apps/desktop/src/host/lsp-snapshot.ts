import {
  LSP_PROVIDERS,
  discoverAllLspProviders,
  type LspProviderDescriptor,
  type LspProviderId,
} from '@spirit-agent/host-internal/lsp';

import type { DesktopLspProviderSnapshot, DesktopLspSnapshot } from '../types.js';
import { normalizeAgentsConfig, type DesktopConfigFile } from './storage.js';

function snapshotFromProvider(
  provider: LspProviderDescriptor,
  status: DesktopLspProviderSnapshot['status'],
  command?: string,
): DesktopLspProviderSnapshot {
  return {
    id: provider.id,
    displayName: provider.displayName,
    languages: [...provider.languageLabels],
    status,
    installKind: provider.installKind,
    ...(provider.npmPackage ? { npmPackage: provider.npmPackage } : {}),
    ...(command ? { command } : {}),
  };
}

export function defaultDesktopLspSnapshot(): DesktopLspSnapshot {
  return {
    userEnabled: true,
    active: false,
    providers: LSP_PROVIDERS.map((provider) => snapshotFromProvider(provider, 'not_found')),
  };
}

export async function buildDesktopLspSnapshot(config: DesktopConfigFile): Promise<DesktopLspSnapshot> {
  const agents = normalizeAgentsConfig(config.agents);
  const userEnabled = agents.lsp.enabled;

  if (!userEnabled) {
    return {
      userEnabled,
      active: false,
      providers: LSP_PROVIDERS.map((provider) => snapshotFromProvider(provider, 'disabled')),
    };
  }

  const discoveries = await discoverAllLspProviders();
  const discoveryById = new Map(discoveries.map((item) => [item.id, item]));

  const providers: DesktopLspProviderSnapshot[] = LSP_PROVIDERS.map((provider) => {
    const discovery = discoveryById.get(provider.id as LspProviderId);
    if (discovery?.status === 'ready') {
      return snapshotFromProvider(provider, 'ready', discovery.command);
    }
    return snapshotFromProvider(provider, 'not_found');
  });

  return {
    userEnabled,
    active: providers.some((provider) => provider.status === 'ready'),
    providers,
  };
}
