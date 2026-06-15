import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';

import { TYPESCRIPT_LANGUAGE_SERVER_COMMAND } from '@spirit-agent/core';

import {
  buildWindowsCommandCandidates,
  isWindowsPlatform,
  splitWindowsPathEntries,
  splitWindowsPathExtEntries,
} from './windows-path.js';

const execFileAsync = promisify(execFile);

export interface ResolvedLanguageServerCommand {
  command: string;
  args: string[];
}

async function resolveCommandViaWindowsWhere(
  command: string,
  args: string[],
): Promise<ResolvedLanguageServerCommand | undefined> {
  try {
    const result = await execFileAsync('where.exe', [command], {
      timeout: 2_000,
      windowsHide: true,
    });
    const firstLine = String(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) {
      return undefined;
    }
    await access(firstLine, constants.F_OK);
    return { command: firstLine, args };
  } catch {
    return undefined;
  }
}

export async function resolveCommandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  args: string[] = [],
): Promise<ResolvedLanguageServerCommand | undefined> {
  if (isWindowsPlatform(platform) && !command.includes('\\') && !command.includes('/')) {
    const fromWhere = await resolveCommandViaWindowsWhere(command, args);
    if (fromWhere) {
      return fromWhere;
    }
  }

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

/** Detect rustup proxy loops when the rust-analyzer component is missing. */
export function isRustAnalyzerVersionOutputHealthy(output: string): boolean {
  if (/infinite recursion detected/i.test(output)) {
    return false;
  }
  return /rust-analyzer/i.test(output);
}

async function runCommandForOutput(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(command, args, {
      env: { ...process.env, ...env },
      timeout: 5_000,
      windowsHide: true,
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
      code: 0,
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    return {
      stdout: String(execError.stdout ?? ''),
      stderr: String(execError.stderr ?? ''),
      code: typeof execError.code === 'number' ? execError.code : 1,
    };
  }
}

async function resolveRustAnalyzerViaRustup(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const rustup = await resolveCommandOnPath('rustup', env, platform, []);
  if (!rustup) {
    return undefined;
  }

  const which = await runCommandForOutput(rustup.command, ['which', 'rust-analyzer'], env);
  if (which.code !== 0) {
    return undefined;
  }

  const resolvedPath = which.stdout.trim();
  if (!resolvedPath) {
    return undefined;
  }

  try {
    await access(resolvedPath, constants.X_OK);
  } catch {
    return undefined;
  }

  return { command: resolvedPath, args: [] };
}

async function isRustAnalyzerHealthy(
  command: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const result = await runCommandForOutput(command, ['--version'], env);
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  return result.code === 0 && isRustAnalyzerVersionOutputHealthy(combined);
}

export async function resolveRustAnalyzerOnPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ResolvedLanguageServerCommand | undefined> {
  const fromRustup = await resolveRustAnalyzerViaRustup(env, platform);
  if (fromRustup && (await isRustAnalyzerHealthy(fromRustup.command, env))) {
    return fromRustup;
  }

  const fromPath = await resolveCommandOnPath('rust-analyzer', env, platform, []);
  if (!fromPath) {
    return undefined;
  }

  if (!(await isRustAnalyzerHealthy(fromPath.command, env))) {
    return undefined;
  }

  return fromPath;
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
