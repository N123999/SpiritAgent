import {
  LSP_PROVIDERS,
  discoverAllLspProviders,
  type LspProviderId,
} from '@spirit-agent/host-internal/lsp';

import type { DesktopLspProviderSnapshot, DesktopLspSnapshot } from '../types.js';
import { normalizeAgentsConfig, type DesktopConfigFile } from './storage.js';

export function defaultDesktopLspSnapshot(): DesktopLspSnapshot {
  return {
    userEnabled: true,
    active: false,
    providers: LSP_PROVIDERS.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      languages: [...provider.languageLabels],
      status: 'not_found',
      npmPackage: provider.npmPackage,
    })),
  };
}

export async function buildDesktopLspSnapshot(config: DesktopConfigFile): Promise<DesktopLspSnapshot> {
  const agents = normalizeAgentsConfig(config.agents);
  const userEnabled = agents.lsp.enabled;

  if (!userEnabled) {
    return {
      userEnabled,
      active: false,
      providers: LSP_PROVIDERS.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        languages: [...provider.languageLabels],
        status: 'disabled',
        npmPackage: provider.npmPackage,
      })),
    };
  }

  const discoveries = await discoverAllLspProviders();
  const discoveryById = new Map(discoveries.map((item) => [item.id, item]));

  const providers: DesktopLspProviderSnapshot[] = LSP_PROVIDERS.map((provider) => {
    const discovery = discoveryById.get(provider.id as LspProviderId);
    if (discovery?.status === 'ready') {
      return {
        id: provider.id,
        displayName: provider.displayName,
        languages: [...provider.languageLabels],
        status: 'ready',
        npmPackage: provider.npmPackage,
        command: discovery.command,
      };
    }
    return {
      id: provider.id,
      displayName: provider.displayName,
      languages: [...provider.languageLabels],
      status: 'not_found',
      npmPackage: provider.npmPackage,
    };
  });

  return {
    userEnabled,
    active: providers.some((provider) => provider.status === 'ready'),
    providers,
  };
}
