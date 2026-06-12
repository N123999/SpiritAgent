import { join } from 'node:path';

import { HookConfigError } from './errors.js';
import {
  DEFAULT_HOOK_TIMEOUT_SECONDS,
  HOOK_CONFIG_VERSION,
  HOOK_EVENT_NAMES,
  HOOKS_CONFIG_FILE_NAME,
  type HookDefinition,
  type HookEventName,
  type HooksConfigFile,
  type ResolvedHookDefinition,
} from './types.js';

export { HOOKS_CONFIG_FILE_NAME };

const SPIRIT = '.spirit';

export function hooksUserConfigPath(dataDir: string): string {
  return join(dataDir, HOOKS_CONFIG_FILE_NAME);
}

export function hooksWorkspaceConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, SPIRIT, HOOKS_CONFIG_FILE_NAME);
}

export function hooksUserScriptsDir(dataDir: string): string {
  return join(dataDir, 'hooks');
}

export function hooksWorkspaceScriptsDir(workspaceRoot: string): string {
  return join(workspaceRoot, SPIRIT, 'hooks');
}

export function emptyHooksConfigFile(): HooksConfigFile {
  return { version: HOOK_CONFIG_VERSION, hooks: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseHookDefinition(raw: unknown, label: string): HookDefinition {
  if (!isRecord(raw)) {
    throw new HookConfigError(`${label} must be an object.`);
  }

  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) {
    throw new HookConfigError(`${label}.command is required.`);
  }

  const definition: HookDefinition = { command };

  if (raw.timeout !== undefined) {
    if (typeof raw.timeout !== 'number' || !Number.isFinite(raw.timeout) || raw.timeout <= 0) {
      throw new HookConfigError(`${label}.timeout must be a positive number.`);
    }
    definition.timeout = raw.timeout;
  }

  if (raw.failClosed !== undefined) {
    if (typeof raw.failClosed !== 'boolean') {
      throw new HookConfigError(`${label}.failClosed must be a boolean.`);
    }
    definition.failClosed = raw.failClosed;
  }

  if (raw.matcher !== undefined) {
    if (typeof raw.matcher !== 'string' || !raw.matcher.trim()) {
      throw new HookConfigError(`${label}.matcher must be a non-empty string.`);
    }
    definition.matcher = raw.matcher.trim();
  }

  return definition;
}

export function parseHooksConfigFile(raw: unknown): HooksConfigFile {
  if (!isRecord(raw)) {
    throw new HookConfigError('hooks.json root must be an object.');
  }

  if (raw.version !== HOOK_CONFIG_VERSION) {
    throw new HookConfigError(`Unsupported hooks.json version: ${String(raw.version)}`);
  }

  if (!isRecord(raw.hooks)) {
    throw new HookConfigError('hooks.json "hooks" must be an object.');
  }

  const hooks: HooksConfigFile['hooks'] = {};
  for (const [key, value] of Object.entries(raw.hooks)) {
    if (!HOOK_EVENT_NAMES.includes(key as HookEventName)) {
      throw new HookConfigError(`Unknown hook event: ${key}`);
    }
    if (!Array.isArray(value)) {
      throw new HookConfigError(`hooks.${key} must be an array.`);
    }
    hooks[key as HookEventName] = value.map((entry, index) =>
      parseHookDefinition(entry, `hooks.${key}[${index}]`),
    );
  }

  return { version: HOOK_CONFIG_VERSION, hooks };
}

export function mergeHooksConfigFiles(
  user: HooksConfigFile,
  workspace: HooksConfigFile,
): HooksConfigFile {
  const merged: HooksConfigFile = { version: HOOK_CONFIG_VERSION, hooks: {} };

  for (const event of HOOK_EVENT_NAMES) {
    const userEntries = user.hooks[event] ?? [];
    const workspaceEntries = workspace.hooks[event] ?? [];
    const combined = [...userEntries, ...workspaceEntries];
    if (combined.length > 0) {
      merged.hooks[event] = combined;
    }
  }

  return merged;
}

export function resolveMergedHookDefinitions(
  user: HooksConfigFile,
  workspace: HooksConfigFile,
  event: HookEventName,
  userConfigDir: string,
  workspaceConfigDir?: string,
  matcherTarget?: string,
): ResolvedHookDefinition[] {
  const resolved: ResolvedHookDefinition[] = [];

  const append = (
    entries: HookDefinition[],
    scope: 'user' | 'workspace',
    configDir: string,
  ) => {
    for (const entry of entries) {
      if (entry.matcher && matcherTarget !== undefined) {
        try {
          const regex = new RegExp(entry.matcher);
          if (!regex.test(matcherTarget)) {
            continue;
          }
        } catch {
          continue;
        }
      }
      resolved.push({
        ...entry,
        scope,
        configDir,
        timeout: entry.timeout !== undefined && entry.timeout > 0
          ? entry.timeout
          : DEFAULT_HOOK_TIMEOUT_SECONDS,
      });
    }
  };

  append(user.hooks[event] ?? [], 'user', userConfigDir);
  if (workspaceConfigDir) {
    append(workspace.hooks[event] ?? [], 'workspace', workspaceConfigDir);
  }

  return resolved;
}

export function resolveHookCommandPath(definition: ResolvedHookDefinition): string {
  const command = definition.command.trim();
  if (command.startsWith('/') || /^[A-Za-z]:\\/.test(command)) {
    return command;
  }
  return join(definition.configDir, command);
}
