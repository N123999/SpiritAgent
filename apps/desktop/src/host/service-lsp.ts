import path from 'node:path';

import { LspService, type LspUserConfig } from '@spirit-agent/agent-core';

export function lspUserConfigFromEnabled(enabled: boolean): LspUserConfig {
  return { enabled };
}

export function sharedLspServiceForWorkspace(
  cache: Map<string, LspService>,
  workspaceRoot: string,
  userConfig: LspUserConfig,
): LspService {
  const key = path.resolve(workspaceRoot);
  let service = cache.get(key);
  if (!service) {
    service = new LspService(key, undefined, userConfig);
    cache.set(key, service);
    return service;
  }

  const previousEnabled = service.getUserConfig().enabled;
  service.setUserConfig(userConfig);
  if (previousEnabled !== userConfig.enabled) {
    service.resetProbe();
  }
  return service;
}

export async function ensureLspServiceReady(service: LspService): Promise<LspService | undefined> {
  if (!service.getUserConfig().enabled) {
    service.resetProbe();
    return undefined;
  }

  const ready = await service.probe();
  return ready ? service : undefined;
}

export async function disposeLspServicesExcept(
  cache: Map<string, LspService>,
  keepWorkspaceRoot?: string,
): Promise<void> {
  const keepKey = keepWorkspaceRoot ? path.resolve(keepWorkspaceRoot) : undefined;
  for (const [key, service] of cache) {
    if (keepKey !== undefined && key === keepKey) {
      continue;
    }
    await service.dispose();
    cache.delete(key);
  }
}

export async function disposeAllLspServices(cache: Map<string, LspService>): Promise<void> {
  for (const [key, service] of cache) {
    await service.dispose();
    cache.delete(key);
  }
}
