import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  emptyHooksConfigFile,
  HOOK_EVENT_NAMES,
  hooksUserConfigPath,
  hooksWorkspaceConfigPath,
  parseHooksConfigFile,
  type HookDefinition,
  type HookEventName,
  type HooksConfigFile,
} from '@spirit-agent/core';

import type {
  DeleteHookEntryRequest,
  DesktopHookListItem,
  DesktopHookScope,
  SaveHookEntryRequest,
} from '../types.js';
import { spiritAgentDataDir } from './storage.js';

export function desktopUserHooksConfigPath(): string {
  return hooksUserConfigPath(spiritAgentDataDir());
}

export function desktopWorkspaceHooksConfigPath(workspaceRoot: string): string {
  return hooksWorkspaceConfigPath(workspaceRoot);
}

export function hooksConfigPathForScope(
  scope: DesktopHookScope,
  workspaceRoot: string,
): string {
  return scope === 'workspace'
    ? desktopWorkspaceHooksConfigPath(workspaceRoot)
    : desktopUserHooksConfigPath();
}

export function loadHooksConfigFileAt(configPath: string): HooksConfigFile {
  if (!existsSync(configPath)) {
    return emptyHooksConfigFile();
  }
  const content = readFileSync(configPath, 'utf8');
  return parseHooksConfigFile(JSON.parse(content) as unknown);
}

export async function saveHooksConfigFileAt(
  configPath: string,
  config: HooksConfigFile,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function mapHookListItems(
  config: HooksConfigFile,
  scope: DesktopHookScope,
  configPath: string,
): DesktopHookListItem[] {
  const items: DesktopHookListItem[] = [];
  for (const event of HOOK_EVENT_NAMES) {
    const entries = config.hooks[event] ?? [];
    entries.forEach((entry, index) => {
      items.push({
        id: `${scope}:${event}:${index}`,
        scope,
        event,
        index,
        command: entry.command,
        configPath,
        ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {}),
        ...(entry.failClosed !== undefined ? { failClosed: entry.failClosed } : {}),
        ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
      });
    });
  }
  return items;
}

export function listDesktopHookListItems(
  workspaceRoot: string,
  workspaceBinding: 'project' | 'none',
): DesktopHookListItem[] {
  const userPath = desktopUserHooksConfigPath();
  const userConfig = loadHooksConfigFileAt(userPath);
  const items = mapHookListItems(userConfig, 'user', userPath);

  if (workspaceBinding !== 'none' && workspaceRoot.trim()) {
    const workspacePath = desktopWorkspaceHooksConfigPath(workspaceRoot);
    const workspaceConfig = loadHooksConfigFileAt(workspacePath);
    items.push(...mapHookListItems(workspaceConfig, 'workspace', workspacePath));
  }

  return items;
}

function normalizeHookDefinition(request: SaveHookEntryRequest): HookDefinition {
  const command = request.command.trim();
  if (!command) {
    throw new Error('Hook command is required.');
  }

  const definition: HookDefinition = { command };
  if (request.timeout !== undefined) {
    definition.timeout = request.timeout;
  }
  if (request.failClosed !== undefined) {
    definition.failClosed = request.failClosed;
  }
  if (request.matcher?.trim()) {
    definition.matcher = request.matcher.trim();
  }
  return definition;
}

export async function saveDesktopHookEntry(options: {
  request: SaveHookEntryRequest;
  workspaceRoot: string;
  workspaceBinding: 'project' | 'none';
}): Promise<void> {
  if (options.request.scope === 'workspace' && options.workspaceBinding === 'none') {
    throw new Error('Workspace hooks require a bound workspace.');
  }

  const configPath = hooksConfigPathForScope(options.request.scope, options.workspaceRoot);
  const config = loadHooksConfigFileAt(configPath);
  const event = options.request.event as HookEventName;
  const entries = [...(config.hooks[event] ?? [])];
  entries.push(normalizeHookDefinition(options.request));
  config.hooks[event] = entries;
  await saveHooksConfigFileAt(configPath, config);
}

export async function deleteDesktopHookEntry(options: {
  request: DeleteHookEntryRequest;
  workspaceRoot: string;
  workspaceBinding: 'project' | 'none';
}): Promise<void> {
  if (options.request.scope === 'workspace' && options.workspaceBinding === 'none') {
    throw new Error('Workspace hooks require a bound workspace.');
  }

  const configPath = hooksConfigPathForScope(options.request.scope, options.workspaceRoot);
  const config = loadHooksConfigFileAt(configPath);
  const event = options.request.event as HookEventName;
  const entries = [...(config.hooks[event] ?? [])];
  if (options.request.index < 0 || options.request.index >= entries.length) {
    throw new Error('Hook entry not found.');
  }
  entries.splice(options.request.index, 1);
  if (entries.length > 0) {
    config.hooks[event] = entries;
  } else {
    delete config.hooks[event];
  }
  await saveHooksConfigFileAt(configPath, config);
}

export function desktopHooksConfigPathsSummary(
  workspaceRoot: string,
  workspaceBinding: 'project' | 'none',
): { user: string; workspace: string | undefined } {
  return {
    user: desktopUserHooksConfigPath(),
    workspace: workspaceBinding === 'none' ? undefined : desktopWorkspaceHooksConfigPath(workspaceRoot),
  };
}
