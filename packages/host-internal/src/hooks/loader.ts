import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  emptyHooksConfigFile,
  HOOK_EVENT_NAMES,
  hooksUserConfigPath,
  hooksWorkspaceConfigPath,
  parseHooksConfigFile,
  resolveHookCommandPath,
  resolveMergedHookDefinitions,
  type HookEventName,
  type HookInput,
  type HooksConfigFile,
  hookMatcherTarget,
} from '@spirit-agent/core';

export interface LoadHooksConfigOptions {
  spiritDataDir: string;
  workspaceRoot: string | undefined;
}

export interface LoadedHooksConfig {
  user: HooksConfigFile;
  workspace: HooksConfigFile;
  userConfigDir: string;
  workspaceConfigDir: string | undefined;
}

export function loadHooksConfigFileAt(configPath: string): HooksConfigFile {
  if (!existsSync(configPath)) {
    return emptyHooksConfigFile();
  }
  try {
    const content = readFileSync(configPath, 'utf8');
    return parseHooksConfigFile(JSON.parse(content) as unknown);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Ignoring invalid hooks config at ${configPath}: ${detail}`);
    return emptyHooksConfigFile();
  }
}

export function loadHooksConfig(options: LoadHooksConfigOptions): LoadedHooksConfig {
  const userConfigPath = hooksUserConfigPath(options.spiritDataDir);
  const user = loadHooksConfigFileAt(userConfigPath);
  const userConfigDir = path.dirname(userConfigPath);

  let workspace = emptyHooksConfigFile();
  let workspaceConfigDir: string | undefined;
  if (options.workspaceRoot?.trim()) {
    const workspaceConfigPath = hooksWorkspaceConfigPath(options.workspaceRoot.trim());
    workspace = loadHooksConfigFileAt(workspaceConfigPath);
    workspaceConfigDir = path.dirname(workspaceConfigPath);
  }

  return {
    user,
    workspace,
    userConfigDir,
    workspaceConfigDir,
  };
}

export function listHookDefinitionsForInput(
  loaded: LoadedHooksConfig,
  input: HookInput,
) {
  return resolveMergedHookDefinitions(
    loaded.user,
    loaded.workspace,
    input.hookEventName,
    loaded.userConfigDir,
    loaded.workspaceConfigDir,
    hookMatcherTarget(input),
  );
}

export function summarizeHooksConfig(loaded: LoadedHooksConfig): Record<HookEventName, number> {
  const summary = {} as Record<HookEventName, number>;
  const events = [
    'sessionStart',
    'sessionEnd',
    'submitPrompt',
    'preToolUse',
    'postToolUse',
    'subagentStart',
    'subagentEnd',
  ] as const;
  for (const event of events) {
    const userCount = loaded.user.hooks[event]?.length ?? 0;
    const workspaceCount = loaded.workspace.hooks[event]?.length ?? 0;
    summary[event] = userCount + workspaceCount;
  }
  return summary;
}

export interface HookValidationEntry {
  scope: 'user' | 'workspace';
  event: HookEventName;
  index: number;
  command: string;
  resolvedPath: string;
  exists: boolean;
}

export function validateHooksConfig(options: LoadHooksConfigOptions): {
  userConfigPath: string;
  workspaceConfigPath: string | undefined;
  summary: Record<HookEventName, number>;
  entries: HookValidationEntry[];
} {
  const loaded = loadHooksConfig(options);
  const userConfigPath = hooksUserConfigPath(options.spiritDataDir);
  const workspaceConfigPath = options.workspaceRoot?.trim()
    ? hooksWorkspaceConfigPath(options.workspaceRoot.trim())
    : undefined;
  const entries: HookValidationEntry[] = [];

  for (const event of HOOK_EVENT_NAMES) {
    const appendScopeEntries = (
      scope: 'user' | 'workspace',
      hookEntries: HooksConfigFile['hooks'][typeof event] | undefined,
      configDir: string,
    ) => {
      for (const [index, entry] of (hookEntries ?? []).entries()) {
        let resolvedPath: string;
        try {
          resolvedPath = resolveHookCommandPath({
            ...entry,
            scope,
            configDir,
            ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
          });
        } catch {
          resolvedPath = entry.command;
        }
        entries.push({
          scope,
          event,
          index,
          command: entry.command,
          resolvedPath,
          exists: existsSync(resolvedPath),
        });
      }
    };

    appendScopeEntries('user', loaded.user.hooks[event], loaded.userConfigDir);
    if (loaded.workspaceConfigDir) {
      appendScopeEntries('workspace', loaded.workspace.hooks[event], loaded.workspaceConfigDir);
    }
  }

  return {
    userConfigPath,
    workspaceConfigPath,
    summary: summarizeHooksConfig(loaded),
    entries,
  };
}
