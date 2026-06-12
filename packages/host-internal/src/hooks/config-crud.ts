import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HOOK_EVENT_NAMES,
  hooksUserConfigPath,
  hooksWorkspaceConfigPath,
  type HookDefinition,
  type HookEventName,
  type HooksConfigFile,
} from '@spirit-agent/core';

import { loadHooksConfigFileAt } from './loader.js';

export type HookConfigScope = 'user' | 'workspace';
export type HookWorkspaceBinding = 'project' | 'none';

export interface HookListItem {
  id: string;
  scope: HookConfigScope;
  event: HookEventName;
  index: number;
  command: string;
  configPath: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface SaveHookEntryRequest {
  scope: HookConfigScope;
  event: HookEventName;
  command: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface DeleteHookEntryRequest {
  scope: HookConfigScope;
  event: HookEventName;
  index: number;
}

export interface HookCrudContext {
  spiritDataDir: string;
  workspaceRoot: string;
  workspaceBinding: HookWorkspaceBinding;
}

async function saveHooksConfigFileAt(
  configPath: string,
  config: HooksConfigFile,
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function hooksConfigPathForScope(
  spiritDataDir: string,
  workspaceRoot: string,
  scope: HookConfigScope,
): string {
  return scope === 'workspace'
    ? hooksWorkspaceConfigPath(workspaceRoot)
    : hooksUserConfigPath(spiritDataDir);
}

function mapHookListItems(
  config: HooksConfigFile,
  scope: HookConfigScope,
  configPath: string,
): HookListItem[] {
  const items: HookListItem[] = [];
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

export function listHookListItems(context: HookCrudContext): HookListItem[] {
  const userPath = hooksUserConfigPath(context.spiritDataDir);
  const userConfig = loadHooksConfigFileAt(userPath);
  const items = mapHookListItems(userConfig, 'user', userPath);

  if (context.workspaceBinding !== 'none' && context.workspaceRoot.trim()) {
    const workspacePath = hooksWorkspaceConfigPath(context.workspaceRoot.trim());
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
    if (!Number.isFinite(request.timeout) || request.timeout <= 0) {
      throw new Error('Hook timeout must be a positive number.');
    }
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

function assertWorkspaceScopeAllowed(
  scope: HookConfigScope,
  workspaceBinding: HookWorkspaceBinding,
): void {
  if (scope === 'workspace' && workspaceBinding === 'none') {
    throw new Error('Workspace hooks require a bound workspace.');
  }
}

export async function saveHookEntry(
  context: HookCrudContext,
  request: SaveHookEntryRequest,
): Promise<void> {
  assertWorkspaceScopeAllowed(request.scope, context.workspaceBinding);

  if (!HOOK_EVENT_NAMES.includes(request.event)) {
    throw new Error(`Unknown hook event: ${request.event}`);
  }

  const configPath = hooksConfigPathForScope(
    context.spiritDataDir,
    context.workspaceRoot,
    request.scope,
  );
  const config = loadHooksConfigFileAt(configPath);
  const event = request.event;
  const entries = [...(config.hooks[event] ?? [])];
  entries.push(normalizeHookDefinition(request));
  config.hooks[event] = entries;
  await saveHooksConfigFileAt(configPath, config);
}

export async function deleteHookEntry(
  context: HookCrudContext,
  request: DeleteHookEntryRequest,
): Promise<void> {
  assertWorkspaceScopeAllowed(request.scope, context.workspaceBinding);

  const configPath = hooksConfigPathForScope(
    context.spiritDataDir,
    context.workspaceRoot,
    request.scope,
  );
  const config = loadHooksConfigFileAt(configPath);
  const event = request.event;
  const entries = [...(config.hooks[event] ?? [])];
  if (request.index < 0 || request.index >= entries.length) {
    throw new Error('Hook entry not found.');
  }
  entries.splice(request.index, 1);
  if (entries.length > 0) {
    config.hooks[event] = entries;
  } else {
    delete config.hooks[event];
  }
  await saveHooksConfigFileAt(configPath, config);
}

export function hooksConfigPathsSummary(context: HookCrudContext): {
  user: string;
  workspace: string | undefined;
} {
  return {
    user: hooksUserConfigPath(context.spiritDataDir),
    workspace: context.workspaceBinding === 'none'
      ? undefined
      : hooksWorkspaceConfigPath(context.workspaceRoot.trim()),
  };
}
