import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { Entry } from '@napi-rs/keyring';
import {
  loadHostInstructionMetadata,
  resolveInstructionPaths,
  type HostInstructionMetadataSummary,
  type HostRuleDiscoveryResult,
  type HostSkillDiscoveryResult,
} from '@spirit-agent/host-internal';

import type {
  ConversationMessageSnapshot,
  ModelProfileSnapshot,
  SessionListItem,
} from '../types.js';
import type { StoredDesktopSession } from './contracts.js';
import { normalizeDesktopRewindMetadata } from './rewind.js';

export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o-mini';
const APP_DATA_DIR_NAME = 'SpiritAgent';
const CONFIG_FILE_NAME = 'config.json';
const CHATS_DIR_NAME = 'chats';

export interface DesktopConfigFile {
  models: ModelProfileSnapshot[];
  activeModel: string;
  uiLocale?: string;
  windowsMica?: boolean;
  planMode?: boolean;
}

/** 与 `apps/cli/src/model_registry.rs` 中 keyring 命名一致。 */
const KEYRING_SERVICE = 'SpiritAgent';
const KEYRING_GLOBAL_ACCOUNT = 'openai_api_key';

function modelKeyAccount(modelName: string): string {
  return `model::${modelName}`;
}

export type RuleDiscoveryResult = HostRuleDiscoveryResult;
export type SkillDiscoveryResult = HostSkillDiscoveryResult;
export type HostMetadataSummary = HostInstructionMetadataSummary;

export function spiritAgentDataDir(): string {
  if (process.env.APPDATA?.trim()) {
    return path.join(process.env.APPDATA.trim(), APP_DATA_DIR_NAME);
  }

  if (process.env.USERPROFILE?.trim()) {
    return path.join(process.env.USERPROFILE.trim(), '.spirit-agent');
  }

  return path.resolve('.spirit-agent');
}

export function chatsDirPath(): string {
  return path.join(spiritAgentDataDir(), CHATS_DIR_NAME);
}

export function configFilePath(): string {
  return path.join(spiritAgentDataDir(), CONFIG_FILE_NAME);
}

export function planFilePath(): string {
  return resolveInstructionPaths({
    workspaceRoot: path.resolve('.'),
    spiritDataDir: spiritAgentDataDir(),
  }).planFile;
}

function readModelKeyFromKeyring(modelName: string): string | undefined {
  try {
    const value = new Entry(KEYRING_SERVICE, modelKeyAccount(modelName)).getPassword();
    const trimmed = value?.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

function readGlobalKeyFromKeyring(): string | undefined {
  try {
    const value = new Entry(KEYRING_SERVICE, KEYRING_GLOBAL_ACCOUNT).getPassword();
    const trimmed = value?.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export function defaultNewSessionPath(): string {
  return path.join(chatsDirPath(), `chat-${Math.floor(Date.now() / 1000)}.json`);
}

export function discoverWorkspaceRoot(start = process.cwd()): string {
  if (process.env.SPIRIT_WORKSPACE_ROOT?.trim()) {
    return path.resolve(process.env.SPIRIT_WORKSPACE_ROOT.trim());
  }

  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      existsSync(path.join(current, 'apps', 'cli')) &&
      existsSync(path.join(current, 'packages', 'agent-core'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(start);
}

export async function loadConfig(): Promise<DesktopConfigFile> {
  const filePath = configFilePath();
  if (!existsSync(filePath)) {
    const initial = defaultConfig();
    await saveConfig(initial);
    return initial;
  }

  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<DesktopConfigFile>;
  return normalizeConfig(parsed);
}

export async function saveConfig(config: DesktopConfigFile): Promise<void> {
  const filePath = configFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export async function resolveApiKeyForModel(modelName: string): Promise<string | undefined> {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const modelKey = readModelKeyFromKeyring(modelName);
  if (modelKey) {
    return modelKey;
  }

  return readGlobalKeyFromKeyring();
}

export async function hasApiKeyForModel(modelName: string): Promise<boolean> {
  return Boolean(await resolveApiKeyForModel(modelName));
}

/** 各模型是否在系统钥匙串中有单独条目（与 CLI `has_model_api_key` 一致；不含环境变量与全局回退）。 */
export async function modelSecretKeyPresence(modelNames: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const name of modelNames) {
    out[name] = Boolean(readModelKeyFromKeyring(name));
  }
  return out;
}

export async function saveApiKeyForModel(modelName: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  new Entry(KEYRING_SERVICE, modelKeyAccount(modelName)).setPassword(trimmed);
}

/** 与 CLI `remove_model_api_key` 一致：删除该模型在钥匙串中的专属条目。 */
export async function removeModelApiKey(modelName: string): Promise<void> {
  try {
    new Entry(KEYRING_SERVICE, modelKeyAccount(modelName)).deletePassword();
  } catch {
    /* 无条目时与 CLI 行为一致 */
  }
}

export async function loadHostMetadata(
  workspaceRoot: string,
  planMode = false,
): Promise<HostMetadataSummary> {
  return loadHostInstructionMetadata({
    workspaceRoot,
    spiritDataDir: spiritAgentDataDir(),
  }, {
    planMode,
  });
}

export async function listStoredSessions(): Promise<SessionListItem[]> {
  const dirPath = chatsDirPath();
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(dirPath, entry.name));

  const loaded = await Promise.all(
    files.map(async (filePath) => {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<StoredDesktopSession>;
        const info = await stat(filePath);
        return {
          path: filePath,
          displayName:
            normalizeDisplayName(parsed.sessionDisplayName) ??
            deriveDisplayName(parsed.desktopMessages, parsed.messages),
          modifiedAtUnixMs:
            typeof parsed.savedAtUnixMs === 'number'
              ? parsed.savedAtUnixMs
              : Math.round(info.mtimeMs),
        } satisfies SessionListItem;
      } catch {
        return undefined;
      }
    }),
  );

  return loaded
    .filter((item): item is SessionListItem => item !== undefined)
    .sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
}

export async function loadStoredSession(filePath: string): Promise<StoredDesktopSession> {
  const resolved = resolveSessionPath(filePath);
  const raw = await readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw) as Partial<StoredDesktopSession>;
  return {
    savedAtUnixMs:
      typeof parsed.savedAtUnixMs === 'number' ? parsed.savedAtUnixMs : Date.now(),
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    assistantAux: Array.isArray(parsed.assistantAux) ? parsed.assistantAux : [],
    llmHistory: Array.isArray(parsed.llmHistory) ? parsed.llmHistory : [],
    subagentSessions: Array.isArray(parsed.subagentSessions)
      ? parsed.subagentSessions
      : [],
    ...(normalizeDisplayName(parsed.sessionDisplayName)
      ? { sessionDisplayName: normalizeDisplayName(parsed.sessionDisplayName) }
      : {}),
    ...(Array.isArray(parsed.desktopMessages)
      ? { desktopMessages: parsed.desktopMessages as ConversationMessageSnapshot[] }
      : {}),
    rewind: normalizeDesktopRewindMetadata(parsed.rewind),
  } satisfies StoredDesktopSession;
}

export async function saveStoredSession(
  filePath: string | undefined,
  session: StoredDesktopSession,
): Promise<string> {
  const resolved = resolveSessionPath(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return resolved;
}

function defaultConfig(): DesktopConfigFile {
  return {
    models: [
      {
        name: DEFAULT_MODEL,
        apiBase: DEFAULT_API_BASE,
      },
    ],
    activeModel: DEFAULT_MODEL,
    windowsMica: true,
    planMode: false,
  };
}

function normalizeConfig(raw: Partial<DesktopConfigFile>): DesktopConfigFile {
  const models = Array.isArray(raw.models)
    ? raw.models
        .filter(
          (model): model is ModelProfileSnapshot =>
            typeof model?.name === 'string' && model.name.trim().length > 0,
        )
        .map((model) => ({
          name: model.name.trim(),
          apiBase: model.apiBase?.trim() || DEFAULT_API_BASE,
        }))
    : [];

  const normalizedModels = models.length > 0 ? models : defaultConfig().models;
  const activeModel = normalizedModels.some((model) => model.name === raw.activeModel)
    ? raw.activeModel!.trim()
    : normalizedModels[0]!.name;

  return {
    models: normalizedModels,
    activeModel,
    ...(typeof raw.uiLocale === 'string' && raw.uiLocale.trim()
      ? { uiLocale: raw.uiLocale.trim() }
      : {}),
    windowsMica: raw.windowsMica !== false,
    planMode: raw.planMode === true,
  };
}

function resolveSessionPath(filePath: string | undefined): string {
  const candidate = filePath?.trim() ? filePath.trim() : defaultNewSessionPath();
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.join(chatsDirPath(), candidate);
  return absolute.toLowerCase().endsWith('.json') ? absolute : `${absolute}.json`;
}

function deriveDisplayName(
  desktopMessages: ConversationMessageSnapshot[] | undefined,
  archiveMessages:
    | Array<{ role: 'user' | 'assistant'; content: string }>
    | undefined,
): string {
  const fromDesktop = desktopMessages?.find(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  )?.content;
  const fromArchive = archiveMessages?.find(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  )?.content;
  const seed = fromDesktop ?? fromArchive ?? 'New conversation';
  return seed.length > 28 ? `${seed.slice(0, 28)}…` : seed;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

