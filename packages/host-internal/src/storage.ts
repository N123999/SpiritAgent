import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SPIRIT_DIR_NAME = '.spirit';
export const AGENTS_DIR_NAME = '.agents';
export const SKILLS_DIR_NAME = 'skills';
export const SKILL_FILE_NAME = 'SKILL.md';
export const USER_RULE_FILE_NAME = 'rule.md';
export const WORKSPACE_RULE_FILE_NAME = 'AGENTS.md';
export const WORKSPACE_SPIRIT_RULE_FILE_NAME = path.join(SPIRIT_DIR_NAME, 'rule.md');
export const WORKSPACE_SPIRIT_SKILLS_DIR = path.join(SPIRIT_DIR_NAME, SKILLS_DIR_NAME);
export const WORKSPACE_AGENTS_SKILLS_DIR = path.join(AGENTS_DIR_NAME, SKILLS_DIR_NAME);
export const PLAN_FILE_NAME = 'plan.md';
export const RULES_STATE_FILE_NAME = 'rules-state.json';
export const SKILLS_STATE_FILE_NAME = 'skills-state.json';
export const EXTENSIONS_DIR_NAME = 'extensions';
export const EXTENSION_MANIFEST_FILE_NAME = 'spirit-extension.json';
export const EXTENSIONS_INDEX_FILE_NAME = 'extensions.json';
export const EXTENSION_STATE_DIR_NAME = 'extension-state';

export type ExtensionSettingValue = string | number | boolean | null;

export interface ExtensionStateStore {
  loadSettings(extensionId: string): Promise<Record<string, ExtensionSettingValue>>;
  saveSettings(
    extensionId: string,
    values: Record<string, ExtensionSettingValue>,
  ): Promise<void>;
  loadSecret?(extensionId: string, key: string): Promise<string | undefined>;
  saveSecret?(extensionId: string, key: string, value: string): Promise<void>;
  deleteSecret?(extensionId: string, key: string): Promise<void>;
  hasSecret?(extensionId: string, key: string): Promise<boolean>;
}

export interface HostStoragePaths {
  workspaceRoot?: string;
  appDataDir: string;
  configFile: string;
  chatsDir: string;
  planFile: string;
}

export interface HostSessionIndexEntry {
  path: string;
  updatedAt: number;
}

export interface HostStateStorage<Config, Session> {
  readonly paths: HostStoragePaths;
  loadConfig(): Promise<Config>;
  saveConfig(config: Config): Promise<void>;
  loadSession(path: string): Promise<Session | undefined>;
  saveSession(path: string, session: Session): Promise<void>;
  listSessions(): Promise<readonly HostSessionIndexEntry[]>;
}

export interface InstructionDiscoveryContext {
  workspaceRoot: string;
  spiritDataDir: string;
}

export interface ExtensionManagementContext {
  spiritDataDir: string;
  stateStore?: ExtensionStateStore;
}

export interface InstructionPaths {
  workspaceSpiritRuleFile: string;
  workspaceAgentsRuleFile: string;
  userRuleFile: string;
  workspaceSpiritSkillsDir: string;
  workspaceAgentsSkillsDir: string;
  userSkillsDir: string;
  rulesStateFile: string;
  skillsStateFile: string;
  planFile: string;
}

export interface HostToggleState {
  enabledOverrides?: Record<string, boolean>;
}

export interface ExtensionPaths {
  extensionsDir: string;
  extensionsIndexFile: string;
  extensionStateDir: string;
}

export function resolveInstructionPaths(context: InstructionDiscoveryContext): InstructionPaths {
  return {
    workspaceSpiritRuleFile: path.join(context.workspaceRoot, WORKSPACE_SPIRIT_RULE_FILE_NAME),
    workspaceAgentsRuleFile: path.join(context.workspaceRoot, WORKSPACE_RULE_FILE_NAME),
    userRuleFile: path.join(context.spiritDataDir, USER_RULE_FILE_NAME),
    workspaceSpiritSkillsDir: path.join(context.workspaceRoot, WORKSPACE_SPIRIT_SKILLS_DIR),
    workspaceAgentsSkillsDir: path.join(context.workspaceRoot, WORKSPACE_AGENTS_SKILLS_DIR),
    userSkillsDir: path.join(context.spiritDataDir, SKILLS_DIR_NAME),
    rulesStateFile: path.join(context.spiritDataDir, RULES_STATE_FILE_NAME),
    skillsStateFile: path.join(context.spiritDataDir, SKILLS_STATE_FILE_NAME),
    planFile: path.join(context.spiritDataDir, PLAN_FILE_NAME),
  };
}

export function resolveExtensionPaths(context: ExtensionManagementContext): ExtensionPaths {
  return {
    extensionsDir: path.join(context.spiritDataDir, EXTENSIONS_DIR_NAME),
    extensionsIndexFile: path.join(context.spiritDataDir, EXTENSIONS_INDEX_FILE_NAME),
    extensionStateDir: path.join(context.spiritDataDir, EXTENSION_STATE_DIR_NAME),
  };
}

export function createFileExtensionStateStore(
  context: ExtensionManagementContext,
): ExtensionStateStore {
  const paths = resolveExtensionPaths(context);

  return {
    async loadSettings(extensionId) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      if (!existsSync(filePath)) {
        return {};
      }

      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, ExtensionSettingValue>;
        return isExtensionSettingsRecord(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    async saveSettings(extensionId, values) {
      const filePath = extensionSettingsFilePath(paths, extensionId);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
    },
  };
}

export async function loadToggleState(filePath: string): Promise<HostToggleState> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as HostToggleState;
    return parsed.enabledOverrides ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveToggleState(filePath: string, state: HostToggleState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function stablePathId(filePath: string): Promise<string> {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  try {
    return normalizePath(await realpath(absolute));
  } catch {
    return normalizePath(absolute);
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function extensionSettingsFilePath(paths: ExtensionPaths, extensionId: string): string {
  return path.join(paths.extensionStateDir, `${extensionId}.json`);
}

function isExtensionSettingsRecord(
  value: Record<string, ExtensionSettingValue> | unknown,
): value is Record<string, ExtensionSettingValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      typeof entry === 'boolean',
  );
}