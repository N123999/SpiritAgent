import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

import {
  buildWindowsCommandCandidates,
  isWindowsPlatform,
  splitWindowsPathEntries,
  splitWindowsPathExtEntries,
} from './windows-path.js';
import { TYPESCRIPT_LANGUAGE_SERVER_COMMAND } from '@spirit-agent/agent-core';

export interface ResolvedLanguageServerCommand {
  command: string;
  args: string[];
}

export async function resolveTypescriptLanguageServerOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const candidates = buildTypescriptLanguageServerCandidates(env, platform);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return { command: candidate, args: ['--stdio'] };
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

export function buildTypescriptLanguageServerCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const command = TYPESCRIPT_LANGUAGE_SERVER_COMMAND;
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
