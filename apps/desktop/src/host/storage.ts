import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  OpenAiEnabledRule,
  OpenAiEnabledSkillCatalogEntry,
  OpenAiPlanMetadata,
} from '@spirit-agent/agent-core';

import type {
  ConversationMessageSnapshot,
  ModelProfileSnapshot,
  SessionListItem,
} from '../types.js';
import type { StoredDesktopSession } from './contracts.js';

export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o-mini';
const APP_DATA_DIR_NAME = 'SpiritAgent';
const CONFIG_FILE_NAME = 'config.json';
const SECRETS_FILE_NAME = 'desktop-secrets.json';
const CHATS_DIR_NAME = 'chats';
const PLAN_FILE_NAME = 'plan.md';
const RULES_STATE_FILE_NAME = 'rules-state.json';
const SKILLS_STATE_FILE_NAME = 'skills-state.json';
const USER_RULE_FILE_NAME = 'rule.md';
const WORKSPACE_RULE_FILE_NAME = 'AGENTS.md';
const WORKSPACE_SPIRIT_RULE_FILE_NAME = path.join('.spirit', 'rule.md');
const WORKSPACE_SPIRIT_SKILLS_DIR = path.join('.spirit', 'skills');
const WORKSPACE_AGENTS_SKILLS_DIR = path.join('.agents', 'skills');
const USER_SKILLS_DIR_NAME = 'skills';
const SKILL_FILE_NAME = 'SKILL.md';

export interface DesktopConfigFile {
  models: ModelProfileSnapshot[];
  activeModel: string;
  uiLocale?: string;
  windowsMica?: boolean;
}

interface DesktopSecretsFile {
  globalApiKey?: string;
  modelApiKeys?: Record<string, string>;
}

interface ToggleStateFile {
  enabledOverrides?: Record<string, boolean>;
}

export interface RuleDiscoveryResult {
  discovered: number;
  enabled: number;
  enabledRules: OpenAiEnabledRule[];
}

export interface SkillDiscoveryResult {
  discovered: number;
  enabled: number;
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[];
}

export interface HostMetadataSummary {
  rules: RuleDiscoveryResult;
  skills: SkillDiscoveryResult;
  planMetadata: OpenAiPlanMetadata;
}

interface ParsedSkillDocument {
  name: string;
  description: string;
}

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
  return path.join(spiritAgentDataDir(), PLAN_FILE_NAME);
}

function secretsFilePath(): string {
  return path.join(spiritAgentDataDir(), SECRETS_FILE_NAME);
}

function rulesStateFilePath(): string {
  return path.join(spiritAgentDataDir(), RULES_STATE_FILE_NAME);
}

function skillsStateFilePath(): string {
  return path.join(spiritAgentDataDir(), SKILLS_STATE_FILE_NAME);
}

function userRulePath(): string {
  return path.join(spiritAgentDataDir(), USER_RULE_FILE_NAME);
}

function userSkillsDir(): string {
  return path.join(spiritAgentDataDir(), USER_SKILLS_DIR_NAME);
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

  const secrets = await loadSecrets();
  const modelKey = secrets.modelApiKeys?.[modelName]?.trim();
  if (modelKey) {
    return modelKey;
  }

  const globalKey = secrets.globalApiKey?.trim();
  return globalKey || undefined;
}

export async function hasApiKeyForModel(modelName: string): Promise<boolean> {
  return Boolean(await resolveApiKeyForModel(modelName));
}

export async function saveApiKeyForModel(modelName: string, apiKey: string): Promise<void> {
  const secrets = await loadSecrets();
  const trimmed = apiKey.trim();
  const next = {
    ...secrets,
    modelApiKeys: {
      ...(secrets.modelApiKeys ?? {}),
      [modelName]: trimmed,
    },
  } satisfies DesktopSecretsFile;
  const filePath = secretsFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export async function loadHostMetadata(workspaceRoot: string): Promise<HostMetadataSummary> {
  const [rules, skills] = await Promise.all([
    discoverRules(workspaceRoot),
    discoverSkills(workspaceRoot),
  ]);

  return {
    rules,
    skills,
    planMetadata: {
      path: planFilePath(),
      exists: existsSync(planFilePath()),
      planMode: false,
      planModeHostInstructions: '',
    },
  };
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
  };
}

async function loadSecrets(): Promise<DesktopSecretsFile> {
  const filePath = secretsFilePath();
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as DesktopSecretsFile;
  } catch {
    return {};
  }
}

async function discoverRules(workspaceRoot: string): Promise<RuleDiscoveryResult> {
  const overrides = await loadToggleState(rulesStateFilePath());
  const candidates = [
    {
      scope: 'workspace' as const,
      title: '工作区 Spirit 规则',
      filePath: path.join(workspaceRoot, WORKSPACE_SPIRIT_RULE_FILE_NAME),
    },
    {
      scope: 'workspace' as const,
      title: '工作区 AGENTS 规则',
      filePath: path.join(workspaceRoot, WORKSPACE_RULE_FILE_NAME),
    },
    {
      scope: 'user' as const,
      title: '用户规则',
      filePath: userRulePath(),
    },
  ];

  const enabledRules: OpenAiEnabledRule[] = [];
  let discovered = 0;
  let enabled = 0;

  for (const candidate of candidates) {
    if (!existsSync(candidate.filePath)) {
      continue;
    }
    discovered += 1;
    const id = stableIdFromPath(candidate.filePath);
    const isEnabled = overrides[id] ?? true;
    if (!isEnabled) {
      continue;
    }
    enabled += 1;
    const content = await readFile(candidate.filePath, 'utf8');
    enabledRules.push({
      id,
      scope: candidate.scope,
      title: candidate.title,
      path: candidate.filePath,
      content,
    });
  }

  return {
    discovered,
    enabled,
    enabledRules,
  };
}

async function discoverSkills(workspaceRoot: string): Promise<SkillDiscoveryResult> {
  const overrides = await loadToggleState(skillsStateFilePath());
  const roots = [
    {
      scope: 'workspace' as const,
      rootPath: path.join(workspaceRoot, WORKSPACE_SPIRIT_SKILLS_DIR),
    },
    {
      scope: 'workspace' as const,
      rootPath: path.join(workspaceRoot, WORKSPACE_AGENTS_SKILLS_DIR),
    },
    {
      scope: 'user' as const,
      rootPath: userSkillsDir(),
    },
  ];

  const seenNames = new Set<string>();
  const enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [];
  let discovered = 0;
  let enabled = 0;

  for (const root of roots) {
    if (!existsSync(root.rootPath)) {
      continue;
    }

    const entries = await readdir(root.rootPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillPath = path.join(root.rootPath, entry.name, SKILL_FILE_NAME);
      if (!existsSync(skillPath)) {
        continue;
      }

      discovered += 1;
      const document = parseSkillDocument(await readFile(skillPath, 'utf8'), entry.name);
      if (seenNames.has(document.name)) {
        continue;
      }

      seenNames.add(document.name);
      const id = stableIdFromPath(skillPath);
      const isEnabled = overrides[id] ?? true;
      if (!isEnabled) {
        continue;
      }

      enabled += 1;
      enabledSkillCatalog.push({
        id,
        scope: root.scope,
        name: document.name,
        description: document.description,
        path: skillPath,
      });
    }
  }

  return {
    discovered,
    enabled,
    enabledSkillCatalog,
  };
}

async function loadToggleState(filePath: string): Promise<Record<string, boolean>> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ToggleStateFile;
    return parsed.enabledOverrides ?? {};
  } catch {
    return {};
  }
}

function parseSkillDocument(content: string, fallbackName: string): ParsedSkillDocument {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return {
      name: fallbackName,
      description: firstMeaningfulLine(trimmed) ?? `${fallbackName} skill`,
    };
  }

  const lines = trimmed.split(/\r?\n/u);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return {
      name: fallbackName,
      description: firstMeaningfulLine(trimmed) ?? `${fallbackName} skill`,
    };
  }

  const frontmatter = lines.slice(1, closingIndex);
  const body = lines.slice(closingIndex + 1).join('\n').trim();
  const name =
    frontmatter
      .find((line) => line.startsWith('name:'))
      ?.slice('name:'.length)
      .trim() || fallbackName;
  const description =
    frontmatter
      .find((line) => line.startsWith('description:'))
      ?.slice('description:'.length)
      .trim() || firstMeaningfulLine(body) || `${name} skill`;

  return { name, description };
}

function firstMeaningfulLine(content: string): string | undefined {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
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

function stableIdFromPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/gu, '/').toLowerCase();
}