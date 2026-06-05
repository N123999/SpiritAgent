import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

import { TYPESCRIPT_LANGUAGE_SERVER_COMMAND } from '@spirit-agent/agent-core';

import {
  buildWindowsCommandCandidates,
  isWindowsPlatform,
  splitWindowsPathEntries,
  splitWindowsPathExtEntries,
} from './windows-path.js';

export interface ResolvedLanguageServerCommand {
  command: string;
  args: string[];
}

export async function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  args: string[] = [],
): Promise<ResolvedLanguageServerCommand | undefined> {
  const candidates = buildCommandCandidates(command, env, platform);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return { command: candidate, args };
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function buildCommandCandidates(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  if (!isWindowsPlatform(platform)) {
    const pathEntries = (env.PATH ?? '').split(':').map((entry) => entry.trim()).filter(Boolean);
    return pathEntries.map((entry) => `${entry.replace(/\/+$/, '')}/${command}`);
  }

  return buildWindowsCommandCandidates(
    command,
    splitWindowsPathEntries(env.Path ?? env.PATH),
    splitWindowsPathExtEntries(env.PATHEXT),
  );
}

export async function resolveRustAnalyzerOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  return resolveCommandOnPath('rust-analyzer', env, platform, []);
}

export async function resolveClangdOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  return resolveCommandOnPath('clangd', env, platform, ['--background-index']);
}

export async function resolvePyrightOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  return resolveCommandOnPath('pyright-langserver', env, platform, ['--stdio']);
}

export async function resolveGoplsOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  return resolveCommandOnPath('gopls', env, platform, []);
}

export async function resolveTypescriptLanguageServerOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  return resolveCommandOnPath(TYPESCRIPT_LANGUAGE_SERVER_COMMAND, env, platform, ['--stdio']);
}

/** @deprecated Use buildCommandCandidates */
export function buildTypescriptLanguageServerCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  return buildCommandCandidates(TYPESCRIPT_LANGUAGE_SERVER_COMMAND, env, platform);
}
