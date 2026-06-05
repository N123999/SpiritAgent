import { TYPESCRIPT_LANGUAGE_SERVER_COMMAND } from '@spirit-agent/agent-core';
import { resolveTypescriptLanguageServerOnPath } from './resolve-server.js';

export type LspProviderId = 'typescript-language-server';

export interface LspProviderDescriptor {
  id: LspProviderId;
  displayName: string;
  languageLabels: string[];
  npmPackage: string;
}

export type LspProviderDiscoveryStatus = 'ready' | 'not_found';

export interface LspProviderDiscoveryResult {
  id: LspProviderId;
  status: LspProviderDiscoveryStatus;
  command?: string;
  args?: string[];
}

export const LSP_PROVIDERS: readonly LspProviderDescriptor[] = [
  {
    id: 'typescript-language-server',
    displayName: 'TypeScript Language Server',
    languageLabels: ['TypeScript', 'JavaScript'],
    npmPackage: 'typescript-language-server',
  },
] as const;

export function findLspProvider(id: string): LspProviderDescriptor | undefined {
  return LSP_PROVIDERS.find((provider) => provider.id === id);
}

export async function discoverLspProvider(
  id: LspProviderId,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<LspProviderDiscoveryResult> {
  if (id !== TYPESCRIPT_LANGUAGE_SERVER_COMMAND) {
    return { id, status: 'not_found' };
  }

  const resolved = await resolveTypescriptLanguageServerOnPath(env, platform);
  if (!resolved) {
    return { id, status: 'not_found' };
  }

  return {
    id,
    status: 'ready',
    command: resolved.command,
    args: resolved.args,
  };
}

export async function discoverAllLspProviders(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<LspProviderDiscoveryResult[]> {
  return Promise.all(LSP_PROVIDERS.map((provider) => discoverLspProvider(provider.id, env, platform)));
}
