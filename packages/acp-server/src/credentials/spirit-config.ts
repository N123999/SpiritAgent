import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { SpiritConfigFile, SpiritModelProfile } from './types.js';

const CONFIG_FILE_NAME = 'config.json';
const APP_DATA_DIR_NAME = 'SpiritAgent';

export function resolveSpiritDataDir(): string {
  const envOverride = process.env['SPIRIT_ACP_DATA_DIR']?.trim()
    || process.env['SPIRIT_AGENT_DATA_DIR']?.trim();
  if (envOverride) {
    return envOverride;
  }

  const appData = process.env['APPDATA']?.trim();
  if (appData) {
    return join(appData, APP_DATA_DIR_NAME);
  }

  const home = process.env['HOME']?.trim() || homedir()?.trim();
  if (home) {
    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', APP_DATA_DIR_NAME);
    }
    if (process.platform === 'linux') {
      const xdgDataHome = process.env['XDG_DATA_HOME']?.trim();
      if (xdgDataHome) {
        return join(xdgDataHome, APP_DATA_DIR_NAME);
      }
      return join(home, '.local', 'share', APP_DATA_DIR_NAME);
    }
    return join(home, '.spirit-agent');
  }

  const userProfile = process.env['USERPROFILE']?.trim();
  if (userProfile) {
    return join(userProfile, '.spirit-agent');
  }

  return join(homedir(), '.spirit-agent');
}

export function configFilePath(spiritDataDir: string): string {
  return join(spiritDataDir, CONFIG_FILE_NAME);
}

function normalizeModelProfile(raw: unknown): SpiritModelProfile | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
  const apiBase = typeof record['apiBase'] === 'string' ? record['apiBase'].trim() : '';
  if (!name || !apiBase) {
    return undefined;
  }

  const profile: SpiritModelProfile = { name, apiBase };
  if (typeof record['provider'] === 'string') {
    profile.provider = record['provider'] as NonNullable<SpiritModelProfile['provider']>;
  }
  if (typeof record['transportKind'] === 'string') {
    profile.transportKind = record['transportKind'] as NonNullable<SpiritModelProfile['transportKind']>;
  }
  if (typeof record['reasoningEffort'] === 'string') {
    profile.reasoningEffort = record['reasoningEffort'] as NonNullable<SpiritModelProfile['reasoningEffort']>;
  }
  if (typeof record['providerSite'] === 'string') {
    profile.providerSite = record['providerSite'];
  }
  if (typeof record['alibabaWorkspaceId'] === 'string') {
    profile.alibabaWorkspaceId = record['alibabaWorkspaceId'];
  }
  if (typeof record['awsRegion'] === 'string') {
    profile.awsRegion = record['awsRegion'];
  }
  if (typeof record['azureResourceName'] === 'string') {
    profile.azureResourceName = record['azureResourceName'];
  }
  if (typeof record['vertexProject'] === 'string') {
    profile.vertexProject = record['vertexProject'];
  }
  if (typeof record['vertexLocation'] === 'string') {
    profile.vertexLocation = record['vertexLocation'];
  }
  if (Array.isArray(record['capabilities'])) {
    profile.capabilities = record['capabilities'] as NonNullable<SpiritModelProfile['capabilities']>;
  }
  return profile;
}

function normalizeConfig(raw: Record<string, unknown>): SpiritConfigFile {
  const modelsRaw = Array.isArray(raw['models']) ? raw['models'] : [];
  const models = modelsRaw
    .map(normalizeModelProfile)
    .filter((model): model is SpiritModelProfile => model !== undefined);

  const activeModel = typeof raw['activeModel'] === 'string' ? raw['activeModel'].trim() : '';
  return {
    ...raw,
    models,
    activeModel: activeModel || models[0]?.name || '',
  };
}

export function loadSpiritConfig(spiritDataDir: string): SpiritConfigFile | undefined {
  const filePath = configFilePath(spiritDataDir);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  return normalizeConfig(raw);
}

export async function saveSpiritConfig(
  spiritDataDir: string,
  config: SpiritConfigFile,
): Promise<void> {
  const filePath = configFilePath(spiritDataDir);
  await mkdir(spiritDataDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function loadActiveModelProfile(spiritDataDir: string): SpiritModelProfile | undefined {
  const config = loadSpiritConfig(spiritDataDir);
  if (!config?.activeModel.trim()) {
    return undefined;
  }
  return config.models.find((model) => model.name === config.activeModel);
}
