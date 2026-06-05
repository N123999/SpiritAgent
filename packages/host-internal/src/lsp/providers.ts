import {
  resolveClangdOnPath,
  resolveGoplsOnPath,
  resolvePyrightOnPath,
  resolveRustAnalyzerOnPath,
  resolveTypescriptLanguageServerOnPath,
} from './resolve-server.js';
import { resolveJdtlsOnPath } from './resolve-server-jdtls.js';
import { resolveOmnisharpOnPath } from './resolve-server-omnisharp.js';

export type LspProviderId =
  | 'typescript-language-server'
  | 'pyright'
  | 'gopls'
  | 'rust-analyzer'
  | 'clangd'
  | 'jdtls'
  | 'omnisharp';

export type LspInstallKind = 'npm' | 'go' | 'rustup' | 'platform' | 'manual' | 'dotnet';

export interface LspProviderDescriptor {
  id: LspProviderId;
  displayName: string;
  languageLabels: string[];
  extensions: readonly string[];
  installKind: LspInstallKind;
  /** npm global package name when installKind is npm */
  npmPackage?: string;
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
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    installKind: 'npm',
    npmPackage: 'typescript-language-server',
  },
  {
    id: 'pyright',
    displayName: 'Pyright',
    languageLabels: ['Python'],
    extensions: ['.py', '.pyi'],
    installKind: 'npm',
    npmPackage: 'pyright',
  },
  {
    id: 'gopls',
    displayName: 'gopls',
    languageLabels: ['Go'],
    extensions: ['.go'],
    installKind: 'go',
  },
  {
    id: 'rust-analyzer',
    displayName: 'rust-analyzer',
    languageLabels: ['Rust'],
    extensions: ['.rs'],
    installKind: 'rustup',
  },
  {
    id: 'clangd',
    displayName: 'clangd',
    languageLabels: ['C', 'C++'],
    extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    installKind: 'platform',
  },
  {
    id: 'jdtls',
    displayName: 'Eclipse JDT Language Server',
    languageLabels: ['Java'],
    extensions: ['.java'],
    installKind: 'manual',
  },
  {
    id: 'omnisharp',
    displayName: 'OmniSharp',
    languageLabels: ['C#'],
    extensions: ['.cs'],
    installKind: 'dotnet',
  },
] as const;

const EXTENSION_TO_PROVIDER = buildExtensionRouteMap(LSP_PROVIDERS);

function buildExtensionRouteMap(
  providers: readonly LspProviderDescriptor[],
): Map<string, LspProviderId> {
  const map = new Map<string, LspProviderId>();
  for (const provider of providers) {
    for (const extension of provider.extensions) {
      map.set(extension.toLowerCase(), provider.id);
    }
  }
  return map;
}

export function findLspProvider(id: string): LspProviderDescriptor | undefined {
  return LSP_PROVIDERS.find((provider) => provider.id === id);
}

export function routeLspProviderForExtension(extension: string): LspProviderId | undefined {
  const normalized = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return EXTENSION_TO_PROVIDER.get(normalized);
}

export function routeLspProviderForPath(resolvedPath: string): LspProviderId | undefined {
  const lastDot = resolvedPath.lastIndexOf('.');
  if (lastDot < 0) {
    return undefined;
  }
  const extension = resolvedPath.slice(lastDot).toLowerCase();
  return routeLspProviderForExtension(extension);
}

type ProviderResolver = (
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) => Promise<{ command: string; args: string[] } | undefined>;

const PROVIDER_RESOLVERS: Partial<Record<LspProviderId, ProviderResolver>> = {
  'typescript-language-server': resolveTypescriptLanguageServerOnPath,
  pyright: resolvePyrightOnPath,
  gopls: resolveGoplsOnPath,
  'rust-analyzer': resolveRustAnalyzerOnPath,
  clangd: resolveClangdOnPath,
  jdtls: resolveJdtlsOnPath,
  omnisharp: resolveOmnisharpOnPath,
};

export async function discoverLspProvider(
  id: LspProviderId,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<LspProviderDiscoveryResult> {
  const resolver = PROVIDER_RESOLVERS[id];
  if (!resolver) {
    return { id, status: 'not_found' };
  }

  const resolved = await resolver(env, platform);
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

/** Register a provider resolver (used when adding new language servers). */
export function registerLspProviderResolver(id: LspProviderId, resolver: ProviderResolver): void {
  PROVIDER_RESOLVERS[id] = resolver;
}
