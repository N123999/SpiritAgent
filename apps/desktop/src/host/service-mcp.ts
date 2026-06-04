import path from 'node:path';

import { McpService } from '@spirit-agent/agent-core';

import i18n from '../lib/i18n-host.js';
import type {
  AddMcpServerRequest,
  DeleteMcpServerRequest,
  DesktopMcpServerInspection,
} from '../types.js';
import type { DesktopWorkspaceBinding } from './storage.js';
import {
  addMcpServerToDisk,
  buildMcpServerConfigFromRequest,
  deleteMcpServerFromDisk,
} from './mcp-config.js';

export function sharedMcpServiceForWorkspace(
  cache: Map<string, McpService>,
  workspaceRoot: string,
  workspaceBinding: DesktopWorkspaceBinding = 'project',
): McpService {
  const includeWorkspaceConfig = workspaceBinding === 'project';
  const key = `${path.resolve(workspaceRoot)}|${includeWorkspaceConfig ? 'project' : 'none'}`;
  let service = cache.get(key);
  if (!service) {
    service = new McpService(path.resolve(workspaceRoot), includeWorkspaceConfig);
    service.startBackgroundRefreshInBackground(false);
    cache.set(key, service);
  }
  return service;
}

export async function addDesktopMcpServer(input: {
  request: AddMcpServerRequest;
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
}): Promise<{ scope: AddMcpServerRequest['scope'] }> {
  const name = input.request.name.trim();
  if (!name) {
    throw new Error(i18n.t('error.mcpNameRequired'));
  }
  if (/\s/u.test(name)) {
    throw new Error(i18n.t('error.mcpNameWhitespace'));
  }

  const endpoint = input.request.endpoint.trim();
  if (!endpoint) {
    throw new Error(input.request.transportType === 'http' ? i18n.t('error.urlRequired') : i18n.t('error.commandRequired'));
  }

  const scope = input.request.scope ?? 'workspace';
  if (scope === 'workspace' && input.workspaceBinding === 'none') {
    throw new Error(
      'Workspace-scoped MCP servers are unavailable when workspace binding is disabled.',
    );
  }
  const serverConfig = buildMcpServerConfigFromRequest({ ...input.request, scope });
  await addMcpServerToDisk(scope, input.workspaceRoot, name, serverConfig);
  return { scope };
}

export async function deleteDesktopMcpServer(input: {
  request: DeleteMcpServerRequest;
  workspaceRoot: string;
}): Promise<{ scope: DeleteMcpServerRequest['scope'] }> {
  const name = input.request.name.trim();
  if (!name) {
    throw new Error(i18n.t('error.mcpNameRequired'));
  }

  const scope = input.request.scope ?? 'user';
  await deleteMcpServerFromDisk(scope, input.workspaceRoot, name);
  return { scope };
}

export async function inspectDesktopMcpServer(input: {
  name: string;
  inspect: (name: string) => Promise<unknown>;
}): Promise<DesktopMcpServerInspection> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error(i18n.t('error.mcpNameRequired'));
  }

  const inspection = await input.inspect(trimmedName) as Record<string, unknown>;
  return {
    name: typeof inspection.name === 'string' ? inspection.name : trimmedName,
    displayName:
      typeof inspection.displayName === 'string'
        ? inspection.displayName
        : trimmedName,
    supportsTools: inspection.supportsTools === true,
    supportsResources: inspection.supportsResources === true,
    supportsPrompts: inspection.supportsPrompts === true,
    toolsCount: typeof inspection.toolsCount === 'number' ? inspection.toolsCount : 0,
    resourcesCount: typeof inspection.resourcesCount === 'number' ? inspection.resourcesCount : 0,
    promptsCount: typeof inspection.promptsCount === 'number' ? inspection.promptsCount : 0,
  };
}
