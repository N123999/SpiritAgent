import { existsSync, readFileSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import i18n from '../lib/i18n-host.js';
import {
  deleteKeyringPassword,
  getKeyringPassword,
  setKeyringPassword,
} from './keyring-secret.js';
import { normalizeLightweightChatModel } from './lightweight-chat-model.js';
import {
  configureLlmClientVersion,
  configureLlmHttpVersion,
  normalizeLlmHttpVersion,
  type LlmHttpVersion,
} from '@spirit-agent/core';
import {
  normalizeModelReasoningEffort,
  resolveModelReasoningEffortForContext,
} from '@spirit-agent/core/reasoning-effort';
import {
  createFileExtensionStateStore,
  type ExtensionManagementContext,
  type ExtensionSettingValue,
  type ExtensionStateStore,
  loadHostInstructionMetadata,
  parseModelProviderId,
  type HostInstructionMetadataSummary,
  type HostRuleDiscoveryResult,
  type HostSkillDiscoveryResult,
} from '@spirit-agent/host-internal';

import { resolveDesktopAgentMode, type DesktopAgentMode } from '../lib/agent-mode.js';
import { normalizeContextUsageSnapshot } from '../lib/context-usage.js';
import { parseModelContextLength } from '../lib/model-context-length.js';

import type {
  ConversationMessageSnapshot,
  DesktopModelCapability,
  DesktopModelProvider,
  DesktopModelReasoningEffort,
  DesktopTransportKind,
  ModelProfileSnapshot,
  SessionListItem,
} from '../types.js';
import type { StoredDesktopSession } from './contracts.js';
import {
  assertChatSchemaVersionV2,
  assertNoLegacyConversationFields,
  ChatSessionSchemaError,
  timelinePersistedSnapshotToMessages,
  validateTimelineSnapshotV2,
  type PersistedDesktopTimelineTurnSnapshot,
} from './chat-schema.js';
import {
  buildModelSecretKeyPresence,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  modelProviderKeyScope,
  providerAccessKeyIdAccount,
  providerKeyAccount,
  providerSecretAccessKeyAccount,
  providerVertexClientEmailAccount,
  providerVertexPrivateKeyAccount,
  type BedrockProviderCredentials,
  type GoogleVertexProviderCredentials,
  type ModelKeyPresenceProfile,
} from './provider-api-key.js';
import { normalizeDesktopRewindMetadata } from './rewind.js';

export type { ModelKeyPresenceProfile } from './provider-api-key.js';
export {
  buildModelSecretKeyPresence,
  hasBedrockRuntimeCredentials,
  hasGoogleVertexRuntimeCredentials,
  modelProviderKeyScope,
  providerKeyAccount,
} from './provider-api-key.js';

export const DEFAULT_API_BASE = 'https://api.openai.com/v1';
export const DEFAULT_DESKTOP_WEB_HOST = '127.0.0.1';
export const DEFAULT_DESKTOP_WEB_PORT = 7788;
const APP_DATA_DIR_NAME = 'SpiritAgent';
const CONFIG_FILE_NAME = 'config.json';
const CHATS_DIR_NAME = 'chats';
const PROVISIONAL_CHATS_DIR_NAME = '__provisional__';
const MAX_RECENT_WORKSPACES = 20;
const MODEL_CAPABILITIES = ['chat', 'image', 'video', 'imageGeneration', 'videoGeneration'] as const;
const DEFAULT_CUSTOM_MODEL_CAPABILITIES: DesktopModelCapability[] = ['chat', 'image'];

export type DesktopWorkspaceBinding = 'project' | 'none';

export interface DesktopDreamConfigFile {
  enabled: boolean;
  collectorModel?: string;
  debugMode: boolean;
}

export interface DesktopLspConfigFile {
  enabled: boolean;
}

export interface DesktopCodeCompletionConfigFile {
  enabled: boolean;
}

export interface DesktopAgentsConfigFile {
  lsp: DesktopLspConfigFile;
  codeCompletion: DesktopCodeCompletionConfigFile;
}

export interface DesktopNetworksConfigFile {
  llmHttpVersion: LlmHttpVersion;
}

export interface DesktopConfigFile {
  models: ModelProfileSnapshot[];
  activeModel: string;
  imageGenerationModel?: string;
  videoGenerationModel?: string;
  lightweightChatModel?: string;
  recentWorkspaces?: string[];
  /** When `none`, cwd is the user home directory and workspace-scoped instructions/MCP are skipped. */
  workspaceBinding?: DesktopWorkspaceBinding;
  /** Last project workspace root before switching to `none`; used when re-selecting a workspace. */
  lastProjectWorkspaceRoot?: string;
  uiLocale?: string;
  windowsMica?: boolean;
  systemNotifications?: boolean;
  agentMode?: DesktopAgentMode;
  /** @deprecated 使用 agentMode。 */
  planMode?: boolean;
  webHost: DesktopWebHostConfigFile;
  dreams: DesktopDreamConfigFile;
  agents: DesktopAgentsConfigFile;
  networks: DesktopNetworksConfigFile;
}

export function normalizeWorkspaceBinding(value: unknown): DesktopWorkspaceBinding {
  return value === 'none' ? 'none' : 'project';
}

export function resolveDesktopHomeDirectory(): string {
  return path.resolve(homedir());
}

export interface DesktopWebHostConfigFile {
  enabled: boolean;
  host: string;
  port: number;
  authTokenHash?: string;
}

/** 与 `apps/cli/src/model_registry.rs` 中 keyring 命名一致。 */
const KEYRING_SERVICE = 'SpiritAgent';
const KEYRING_GLOBAL_ACCOUNT = 'openai_api_key';

function modelKeyAccount(modelName: string): string {
  return `model::${modelName}`;
}

function extensionSecretAccount(extensionId: string, key: string): string {
  return `extension::${extensionId}::secret::${key}`;
}

export type RuleDiscoveryResult = HostRuleDiscoveryResult;
export type SkillDiscoveryResult = HostSkillDiscoveryResult;
export type HostMetadataSummary = HostInstructionMetadataSummary;

const ENV_SPIRIT_AGENT_DATA_DIR = 'SPIRIT_AGENT_DATA_DIR';

let spiritAgentDataDirOverride: string | undefined;

export function setSpiritAgentDataDirOverride(dir: string | undefined): void {
  spiritAgentDataDirOverride = dir;
}

function resolveHomeDirectory(): string | undefined {
  const home = process.env.HOME?.trim() || homedir()?.trim();
  return home || undefined;
}

export function resolveDefaultSpiritAgentDataDir(): string {
  const appData = process.env.APPDATA?.trim();
  if (appData) {
    return path.join(appData, APP_DATA_DIR_NAME);
  }

  const home = resolveHomeDirectory();
  if (home) {
    if (process.platform === 'darwin') {
      return path.join(home, 'Library', 'Application Support', APP_DATA_DIR_NAME);
    }
    if (process.platform === 'linux') {
      const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
      if (xdgDataHome) {
        return path.join(xdgDataHome, APP_DATA_DIR_NAME);
      }
      return path.join(home, '.local', 'share', APP_DATA_DIR_NAME);
    }
    return path.join(home, '.spirit-agent');
  }

  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile) {
    return path.join(userProfile, '.spirit-agent');
  }

  return path.join(homedir(), '.spirit-agent');
}

export function resolveConfiguredSpiritAgentDataDir(): string {
  const envOverride = process.env[ENV_SPIRIT_AGENT_DATA_DIR]?.trim();
  if (envOverride) {
    return envOverride;
  }

  return resolveDefaultSpiritAgentDataDir();
}

export function spiritAgentDataDir(): string {
  if (spiritAgentDataDirOverride) {
    return spiritAgentDataDirOverride;
  }

  return resolveConfiguredSpiritAgentDataDir();
}

export function chatsDirPath(): string {
  return path.join(spiritAgentDataDir(), CHATS_DIR_NAME);
}

export function configFilePath(): string {
  return path.join(spiritAgentDataDir(), CONFIG_FILE_NAME);
}

function readModelKeyFromKeyring(modelName: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function readGlobalKeyFromKeyring(): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, KEYRING_GLOBAL_ACCOUNT);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderAccessKeyIdFromKeyring(providerId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderSecretAccessKeyFromKeyring(providerId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderVertexClientEmailFromKeyring(providerId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readProviderVertexPrivateKeyFromKeyring(providerId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function readBedrockProviderCredentialsFromKeyring(
  providerId: DesktopModelProvider,
): BedrockProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(providerId),
    accessKeyId: readProviderAccessKeyIdFromKeyring(providerId),
    secretAccessKey: readProviderSecretAccessKeyFromKeyring(providerId),
  };
}

export async function saveBedrockProviderCredentialsForProvider(
  providerId: DesktopModelProvider,
  credentials: BedrockProviderCredentials,
): Promise<void> {
  const apiKey = credentials.apiKey?.trim();
  if (apiKey) {
    await saveApiKeyForProvider(providerId, apiKey);
  } else {
    await removeProviderApiKey(providerId);
  }

  const accessKeyId = credentials.accessKeyId?.trim();
  if (accessKeyId) {
    setKeyringPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId), accessKeyId);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId));
  }

  const secretAccessKey = credentials.secretAccessKey?.trim();
  if (secretAccessKey) {
    setKeyringPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId), secretAccessKey);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId));
  }
}

export async function removeBedrockProviderCredentials(providerId: DesktopModelProvider): Promise<void> {
  await removeProviderApiKey(providerId);
  deleteKeyringPassword(KEYRING_SERVICE, providerAccessKeyIdAccount(providerId));
  deleteKeyringPassword(KEYRING_SERVICE, providerSecretAccessKeyAccount(providerId));
}

export function readGoogleVertexProviderCredentialsFromKeyring(
  providerId: DesktopModelProvider,
): GoogleVertexProviderCredentials {
  return {
    apiKey: readProviderKeyFromKeyring(providerId),
    clientEmail: readProviderVertexClientEmailFromKeyring(providerId),
    privateKey: readProviderVertexPrivateKeyFromKeyring(providerId),
  };
}

export async function saveGoogleVertexProviderCredentialsForProvider(
  providerId: DesktopModelProvider,
  credentials: GoogleVertexProviderCredentials,
): Promise<void> {
  const apiKey = credentials.apiKey?.trim();
  if (apiKey) {
    await saveApiKeyForProvider(providerId, apiKey);
  } else {
    await removeProviderApiKey(providerId);
  }

  const clientEmail = credentials.clientEmail?.trim();
  if (clientEmail) {
    setKeyringPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId), clientEmail);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId));
  }

  const privateKey = credentials.privateKey?.trim();
  if (privateKey) {
    setKeyringPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId), privateKey);
  } else {
    deleteKeyringPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId));
  }
}

export async function removeGoogleVertexProviderCredentials(
  providerId: DesktopModelProvider,
): Promise<void> {
  await removeProviderApiKey(providerId);
  deleteKeyringPassword(KEYRING_SERVICE, providerVertexClientEmailAccount(providerId));
  deleteKeyringPassword(KEYRING_SERVICE, providerVertexPrivateKeyAccount(providerId));
}

export function readProviderKeyFromKeyring(providerId: string): string | undefined {
  const value = getKeyringPassword(KEYRING_SERVICE, providerKeyAccount(providerId));
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function defaultNewSessionPath(): string {
  return path.join(chatsDirPath(), `chat-${Math.floor(Date.now() / 1000)}.json`);
}

export function provisionalChatsDirPath(): string {
  return path.join(chatsDirPath(), PROVISIONAL_CHATS_DIR_NAME);
}

export function workspaceSessionKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot.trim() || process.cwd());
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

/** Stable in-memory-only session slot per workspace; never listed in the sidebar until first send. */
export function provisionalNewSessionPath(workspaceRoot: string): string {
  return path.join(
    provisionalChatsDirPath(),
    `${workspaceSessionKey(workspaceRoot)}.json`,
  );
}

export function isProvisionalSessionPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const provisionalDir = path.resolve(provisionalChatsDirPath());
  const relative = path.relative(provisionalDir, resolved);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
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

export async function resolveApiKeyForModel(
  modelName: string,
  provider?: DesktopModelProvider,
): Promise<string | undefined> {
  const envKey = process.env.SPIRIT_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  const providerKey = readProviderKeyFromKeyring(modelProviderKeyScope(provider));
  if (providerKey) {
    return providerKey;
  }

  const modelKey = readModelKeyFromKeyring(modelName);
  if (modelKey) {
    return modelKey;
  }

  return readGlobalKeyFromKeyring();
}

export async function hasApiKeyForModel(
  modelName: string,
  provider?: DesktopModelProvider,
): Promise<boolean> {
  return Boolean(await resolveApiKeyForModel(modelName, provider));
}

export async function resolveApiKeyForConfigModel(
  config: Pick<DesktopConfigFile, 'models'>,
  modelName: string,
): Promise<string | undefined> {
  const profile = config.models.find((model) => model.name === modelName);
  return resolveApiKeyForModel(modelName, profile?.provider);
}

function normalizePresenceProfiles(
  profilesOrNames: string[] | ModelKeyPresenceProfile[] | ModelProfileSnapshot[],
): ModelKeyPresenceProfile[] {
  if (profilesOrNames.length === 0) {
    return [];
  }
  const first = profilesOrNames[0];
  if (typeof first === 'string') {
    return (profilesOrNames as string[]).map((name) => ({ name }));
  }
  if ('apiBase' in first && typeof first === 'object' && first !== null) {
    return (profilesOrNames as ModelProfileSnapshot[]).map(toModelKeyPresenceProfile);
  }
  return profilesOrNames as ModelKeyPresenceProfile[];
}

function hasProviderSecretInKeyring(providerId: string, profile: ModelKeyPresenceProfile): boolean {
  if (readProviderKeyFromKeyring(providerId)) {
    return true;
  }
  if (providerId === 'amazon-bedrock') {
    return hasBedrockRuntimeCredentials(readBedrockProviderCredentialsFromKeyring('amazon-bedrock'));
  }
  if (providerId === 'google-vertex-ai') {
    const credentials = readGoogleVertexProviderCredentialsFromKeyring('google-vertex-ai');
    return hasGoogleVertexRuntimeCredentials({
      apiKey: credentials.apiKey,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
      vertexProject: profile.vertexProject,
      vertexLocation: profile.vertexLocation,
    });
  }
  return false;
}

function toModelKeyPresenceProfile(model: ModelProfileSnapshot): ModelKeyPresenceProfile {
  return {
    name: model.name,
    provider: model.provider,
    ...(model.vertexProject ? { vertexProject: model.vertexProject } : {}),
    ...(model.vertexLocation ? { vertexLocation: model.vertexLocation } : {}),
  };
}

/** 各模型是否在钥匙串中有提供商级或遗留模型级条目（不含环境变量与全局回退）。 */
export async function modelSecretKeyPresence(
  profilesOrNames: string[] | ModelKeyPresenceProfile[] | ModelProfileSnapshot[],
): Promise<Record<string, boolean>> {
  const profiles = normalizePresenceProfiles(profilesOrNames);
  return buildModelSecretKeyPresence(
    profiles,
    hasProviderSecretInKeyring,
    (modelName) => Boolean(readModelKeyFromKeyring(modelName)),
  );
}

export async function saveApiKeyForModel(modelName: string, apiKey: string): Promise<void> {
  setKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName), apiKey.trim());
}

export async function saveApiKeyForProvider(
  providerId: DesktopModelProvider,
  apiKey: string,
): Promise<void> {
  setKeyringPassword(KEYRING_SERVICE, providerKeyAccount(providerId), apiKey.trim());
}

/** 删除提供商在钥匙串中的共享 API Key 条目。 */
export async function removeProviderApiKey(providerId: DesktopModelProvider): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, providerKeyAccount(providerId));
}

/** 与 CLI `remove_model_api_key` 一致：删除该模型在钥匙串中的专属条目。 */
export async function removeModelApiKey(modelName: string): Promise<void> {
  deleteKeyringPassword(KEYRING_SERVICE, modelKeyAccount(modelName));
}

export function createDesktopExtensionStateStore(
  context: ExtensionManagementContext = { spiritDataDir: spiritAgentDataDir(), hostKind: 'desktop' },
): ExtensionStateStore {
  const fileStore = createFileExtensionStateStore(context);

  return {
    loadSettings(extensionId) {
      return fileStore.loadSettings(extensionId);
    },
    saveSettings(extensionId, values) {
      return fileStore.saveSettings(extensionId, values);
    },
    async loadSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      const trimmed = value?.trim();
      return trimmed || undefined;
    },
    async saveSecret(extensionId, key, value) {
      setKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key), value.trim());
    },
    async deleteSecret(extensionId, key) {
      deleteKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
    },
    async hasSecret(extensionId, key) {
      const value = getKeyringPassword(KEYRING_SERVICE, extensionSecretAccount(extensionId, key));
      return Boolean(value?.trim());
    },
  };
}

export async function loadHostMetadata(
  workspaceRoot: string,
  agentMode: DesktopAgentMode = 'agent',
  options?: { activePlanPath?: string; workspaceBinding?: DesktopWorkspaceBinding },
): Promise<HostMetadataSummary> {
  const workspaceBinding = options?.workspaceBinding ?? 'project';
  return loadHostInstructionMetadata({
    workspaceRoot,
    spiritDataDir: spiritAgentDataDir(),
    includeWorkspaceScope: workspaceBinding === 'project',
  }, {
    agentMode,
    activePlanPath: options?.activePlanPath,
  });
}

function normalizeStoredSession(parsed: Partial<StoredDesktopSession>): StoredDesktopSession {
  const raw = parsed as Record<string, unknown>;
  assertChatSchemaVersionV2(parsed.chatSchemaVersion);
  assertNoLegacyConversationFields(raw);
  if ('subagentDesktopMessages' in raw) {
    throw new ChatSessionSchemaError('chat schema v2 must not include subagentDesktopMessages');
  }
  if (!Array.isArray(parsed.desktopMessageTimeline)) {
    throw new ChatSessionSchemaError('desktopMessageTimeline is required in chat schema v2');
  }
  const desktopMessageTimeline = parsed.desktopMessageTimeline as PersistedDesktopTimelineTurnSnapshot[];
  validateTimelineSnapshotV2(desktopMessageTimeline);

  const contextUsage = normalizeContextUsageSnapshot(parsed.contextUsage);
  return {
    chatSchemaVersion: 2,
    llmHistory: Array.isArray(parsed.llmHistory) ? parsed.llmHistory : [],
    subagentSessions: Array.isArray(parsed.subagentSessions)
      ? parsed.subagentSessions
      : [],
    loopEnabled: parsed.loopEnabled === true,
    ...(parsed.approvalLevel === 'default' || parsed.approvalLevel === 'full-approval'
      ? { approvalLevel: parsed.approvalLevel }
      : {}),
    desktopMessageTimeline,
    savedAtUnixMs:
      typeof parsed.savedAtUnixMs === 'number' ? parsed.savedAtUnixMs : Date.now(),
    ...(normalizeDisplayName(parsed.sessionDisplayName)
      ? { sessionDisplayName: normalizeDisplayName(parsed.sessionDisplayName) }
      : {}),
    ...(parsed.sessionTitleSource === 'seed' || parsed.sessionTitleSource === 'llm'
      ? { sessionTitleSource: parsed.sessionTitleSource }
      : {}),
    ...(resolveStoredWorkspaceRoot(parsed.workspaceRoot)
      ? { workspaceRoot: resolveStoredWorkspaceRoot(parsed.workspaceRoot) }
      : {}),
    ...(normalizeGitBranch(parsed.gitBranch) ? { gitBranch: normalizeGitBranch(parsed.gitBranch) } : {}),
    ...(typeof parsed.activePlanPath === 'string' && parsed.activePlanPath.trim()
      ? { activePlanPath: parsed.activePlanPath.trim() }
      : {}),
    ...(contextUsage ? { contextUsage } : {}),
    rewind: normalizeDesktopRewindMetadata(parsed.rewind),
    ...(parsed.subagentDesktopTimelines && typeof parsed.subagentDesktopTimelines === 'object'
      ? { subagentDesktopTimelines: parsed.subagentDesktopTimelines as Record<string, PersistedDesktopTimelineTurnSnapshot[]> }
      : {}),
    ...(typeof parsed.automationId === 'string' && parsed.automationId.trim()
      ? { automationId: parsed.automationId.trim() }
      : {}),
    ...(typeof parsed.automationRunId === 'string' && parsed.automationRunId.trim()
      ? { automationRunId: parsed.automationRunId.trim() }
      : {}),
  } satisfies StoredDesktopSession;
}

export async function listStoredSessions(): Promise<SessionListItem[]> {
  const dirPath = chatsDirPath();
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => path.join(dirPath, entry.name))
    .filter((filePath) => !isProvisionalSessionPath(filePath));

  const loaded = await Promise.all(
    files.map(async (filePath) => {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = normalizeStoredSession(JSON.parse(raw) as Partial<StoredDesktopSession>);
        const info = await stat(filePath);
        const gitBranch = normalizeGitBranch(parsed.gitBranch);
        return {
          path: filePath,
          displayName:
            normalizeDisplayName(parsed.sessionDisplayName) ??
            deriveDisplayNameFromTimeline(parsed.desktopMessageTimeline),
          workspaceRoot:
            resolveStoredWorkspaceRoot(parsed.workspaceRoot) ?? discoverWorkspaceRoot(),
          ...(gitBranch ? { gitBranch } : {}),
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
  return normalizeStoredSession(JSON.parse(raw) as Partial<StoredDesktopSession>);
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

export async function deleteStoredSession(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const chatsDir = path.resolve(chatsDirPath());
  const relative = path.relative(chatsDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(i18n.t('error.invalidSessionPath'));
  }
  if (existsSync(resolved)) {
    await unlink(resolved);
  }
}

function defaultConfig(): DesktopConfigFile {
  return {
    models: [],
    activeModel: '',
    recentWorkspaces: [],
    windowsMica: true,
    systemNotifications: true,
    agentMode: 'agent',
    webHost: defaultWebHostConfig(),
    dreams: defaultDreamConfig(),
    agents: defaultAgentsConfig(),
    networks: defaultNetworksConfig(),
  };
}

function normalizeGitBranch(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function defaultWebHostConfig(): DesktopWebHostConfigFile {
  return {
    enabled: false,
    host: DEFAULT_DESKTOP_WEB_HOST,
    port: DEFAULT_DESKTOP_WEB_PORT,
  };
}

export function defaultDreamConfig(): DesktopDreamConfigFile {
  return {
    enabled: false,
    debugMode: false,
  };
}

export function defaultAgentsConfig(): DesktopAgentsConfigFile {
  return {
    lsp: {
      enabled: true,
    },
    codeCompletion: {
      enabled: true,
    },
  };
}

export function defaultNetworksConfig(): DesktopNetworksConfigFile {
  return {
    llmHttpVersion: 'http2',
  };
}

export function normalizeNetworksConfig(raw: unknown): DesktopNetworksConfigFile {
  const record =
    typeof raw === 'object' && raw !== null ? (raw as Partial<DesktopNetworksConfigFile>) : {};
  return {
    llmHttpVersion: normalizeLlmHttpVersion(record.llmHttpVersion),
  };
}

function resolveDesktopPackageJsonPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, '../../../package.json'),
    path.join(moduleDir, '../../package.json'),
  ];
  const packageJsonPath = candidates.find((candidate) => existsSync(candidate));
  if (!packageJsonPath) {
    throw new Error(`未找到 Desktop package.json（自 ${moduleDir} 向上查找）`);
  }
  return packageJsonPath;
}

let cachedDesktopAppVersion: string | undefined;

export function resolveDesktopAppVersion(): string {
  cachedDesktopAppVersion ??= (JSON.parse(
    readFileSync(resolveDesktopPackageJsonPath(), 'utf8'),
  ) as { version: string }).version;
  return cachedDesktopAppVersion;
}

export function applyLlmClientVersionFromApp(): void {
  configureLlmClientVersion(resolveDesktopAppVersion());
}

export function applyLlmHttpVersionFromConfig(config: Pick<DesktopConfigFile, 'networks'>): void {
  configureLlmHttpVersion(config.networks.llmHttpVersion);
}

export function normalizeAgentsConfig(raw: unknown): DesktopAgentsConfigFile {
  const record = typeof raw === 'object' && raw !== null ? (raw as Partial<DesktopAgentsConfigFile>) : {};
  const lspRaw =
    typeof record.lsp === 'object' && record.lsp !== null
      ? (record.lsp as Partial<DesktopLspConfigFile>)
      : {};
  const codeCompletionRaw =
    typeof record.codeCompletion === 'object' && record.codeCompletion !== null
      ? (record.codeCompletion as Partial<DesktopCodeCompletionConfigFile>)
      : {};
  return {
    lsp: {
      enabled: lspRaw.enabled !== false,
    },
    codeCompletion: {
      enabled: codeCompletionRaw.enabled !== false,
    },
  };
}

function normalizeConfig(raw: Partial<DesktopConfigFile>): DesktopConfigFile {
  const models = Array.isArray(raw.models)
    ? raw.models
        .filter(
          (model): model is ModelProfileSnapshot =>
            typeof model?.name === 'string' && model.name.trim().length > 0,
        )
        .map((model) => {
          const provider = parseModelProviderId(model.provider);
          const transportKind = normalizeDesktopTransportKind(model.transportKind, provider);
          const capabilities = normalizeModelCapabilities(model.capabilities);
          const supportedReasoningEfforts = normalizeSupportedReasoningEfforts(model.supportedReasoningEfforts);
          const contextLength = parseModelContextLength(model.contextLength);
          const awsRegion =
            typeof model.awsRegion === 'string' && model.awsRegion.trim().length > 0
              ? model.awsRegion.trim()
              : undefined;
          const providerSite =
            typeof model.providerSite === 'string' && model.providerSite.trim().length > 0
              ? model.providerSite.trim()
              : undefined;
          const alibabaWorkspaceId =
            typeof model.alibabaWorkspaceId === 'string' && model.alibabaWorkspaceId.trim().length > 0
              ? model.alibabaWorkspaceId.trim()
              : undefined;
          const vertexProject =
            typeof model.vertexProject === 'string' && model.vertexProject.trim().length > 0
              ? model.vertexProject.trim()
              : undefined;
          const vertexLocation =
            typeof model.vertexLocation === 'string' && model.vertexLocation.trim().length > 0
              ? model.vertexLocation.trim()
              : undefined;
          const azureResourceName =
            typeof model.azureResourceName === 'string' && model.azureResourceName.trim().length > 0
              ? model.azureResourceName.trim()
              : undefined;
          if (provider === 'azure' && !azureResourceName) {
            return null;
          }
          return {
            name: model.name.trim(),
            apiBase: model.apiBase?.trim() || DEFAULT_API_BASE,
            reasoningEffort: resolveModelReasoningEffortForContext(model.reasoningEffort, {
              ...(provider ? { provider } : {}),
              model: model.name,
              ...(transportKind ? { transportKind } : {}),
              ...(supportedReasoningEfforts !== undefined ? { supportedEfforts: supportedReasoningEfforts } : {}),
            }),
            ...(supportedReasoningEfforts !== undefined ? { supportedReasoningEfforts } : {}),
            ...(capabilities ? { capabilities } : {}),
            ...(provider ? { provider } : {}),
            ...(transportKind ? { transportKind } : {}),
            ...(providerSite ? { providerSite } : {}),
            ...(alibabaWorkspaceId ? { alibabaWorkspaceId } : {}),
            ...(awsRegion ? { awsRegion } : {}),
            ...(vertexProject ? { vertexProject } : {}),
            ...(vertexLocation ? { vertexLocation } : {}),
            ...(azureResourceName ? { azureResourceName } : {}),
            ...(contextLength !== undefined ? { contextLength } : {}),
            ...(model.thinkingEnabled === false ? { thinkingEnabled: false } : {}),
          };
        })
        .filter((model): model is ModelProfileSnapshot => model !== null)
    : [];

  const normalizedModels = models;
  const activeModel =
    normalizedModels.length === 0
      ? (typeof raw.activeModel === 'string' ? raw.activeModel.trim() : '')
      : normalizedModels.some((model) => model.name === raw.activeModel?.trim())
        ? raw.activeModel!.trim()
        : normalizedModels[0]!.name;
  const imageGenerationModel = normalizeImageGenerationModel(raw.imageGenerationModel, normalizedModels);
  const videoGenerationModel = normalizeVideoGenerationModel(raw.videoGenerationModel, normalizedModels);
  const dreams = normalizeDreamConfig(raw.dreams);
  const lightweightChatModel = normalizeLightweightChatModel(
    raw.lightweightChatModel ?? dreams.collectorModel,
    normalizedModels,
  );

  return {
    models: normalizedModels,
    activeModel,
    ...(imageGenerationModel ? { imageGenerationModel } : {}),
    ...(videoGenerationModel ? { videoGenerationModel } : {}),
    ...(lightweightChatModel ? { lightweightChatModel } : {}),
    recentWorkspaces: normalizeRecentWorkspaceRoots(raw.recentWorkspaces),
    workspaceBinding: normalizeWorkspaceBinding(raw.workspaceBinding),
    ...(typeof raw.lastProjectWorkspaceRoot === 'string' && raw.lastProjectWorkspaceRoot.trim()
      ? { lastProjectWorkspaceRoot: path.resolve(raw.lastProjectWorkspaceRoot.trim()) }
      : {}),
    ...(typeof raw.uiLocale === 'string' && raw.uiLocale.trim()
      ? { uiLocale: raw.uiLocale.trim() }
      : {}),
    windowsMica: raw.windowsMica !== false,
    systemNotifications: raw.systemNotifications !== false,
    agentMode: resolveDesktopAgentMode({ agentMode: raw.agentMode, planMode: raw.planMode }),
    webHost: normalizeWebHostConfig(raw.webHost),
    dreams,
    agents: normalizeAgentsConfig(raw.agents),
    networks: normalizeNetworksConfig(raw.networks),
  };
}

function normalizeImageGenerationModel(
  value: unknown,
  models: readonly ModelProfileSnapshot[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const modelName = value.trim();
  const profile = models.find((model) => model.name === modelName);
  return profile && modelSupportsImageGeneration(profile) ? profile.name : undefined;
}

function modelSupportsImageGeneration(model: ModelProfileSnapshot): boolean {
  return model.capabilities?.includes('imageGeneration') === true;
}

function normalizeVideoGenerationModel(
  value: unknown,
  models: readonly ModelProfileSnapshot[],
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const modelName = value.trim();
  const profile = models.find((model) => model.name === modelName);
  return profile && modelSupportsVideoGeneration(profile) ? profile.name : undefined;
}

function modelSupportsVideoGeneration(model: ModelProfileSnapshot): boolean {
  return model.capabilities?.includes('videoGeneration') === true;
}

function normalizeDesktopTransportKind(
  value: unknown,
  provider?: DesktopModelProvider,
): DesktopTransportKind | undefined {
  if (provider === 'azure') {
    return 'open-responses';
  }

  if (
    value === 'openai-compatible'
    || value === 'open-responses'
    || value === 'anthropic'
    || value === 'bedrock'
  ) {
    return value;
  }

  if (provider === 'anthropic') {
    return 'anthropic';
  }
  if (provider === 'amazon-bedrock') {
    return 'bedrock';
  }

  return undefined;
}

export function normalizeModelCapabilities(
  value: unknown,
): DesktopModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowed = new Set<string>(MODEL_CAPABILITIES);
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const normalizedItem = item === 'vision' ? 'image' : item;
    if (!allowed.has(normalizedItem)) {
      continue;
    }
    const capability = normalizedItem as DesktopModelCapability;
    if (seen.has(capability)) {
      continue;
    }
    seen.add(capability);
    normalized.push(capability);
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function defaultCustomModelCapabilities(): DesktopModelCapability[] {
  return [...DEFAULT_CUSTOM_MODEL_CAPABILITIES];
}

export function normalizeSupportedReasoningEfforts(
  value: unknown,
): DesktopModelReasoningEffort[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: DesktopModelReasoningEffort[] = [];
  for (const item of value) {
    const effort = normalizeModelReasoningEffort(item);
    if (!effort || effort === 'default' || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }

  return normalized;
}

export function normalizeDreamConfig(
  raw?: Partial<DesktopDreamConfigFile>,
): DesktopDreamConfigFile {
  const collectorModel = typeof raw?.collectorModel === 'string' && raw.collectorModel.trim()
    ? raw.collectorModel.trim()
    : undefined;
  return {
    enabled: raw?.enabled === true,
    ...(collectorModel ? { collectorModel } : {}),
    debugMode: raw?.debugMode === true,
  };
}

export function normalizeWebHostConfig(
  raw?: Partial<DesktopWebHostConfigFile>,
): DesktopWebHostConfigFile {
  const defaultConfig = defaultWebHostConfig();
  const host = typeof raw?.host === 'string' && raw.host.trim()
    ? raw.host.trim()
    : defaultConfig.host;
  const port = normalizePort(raw?.port, defaultConfig.port);
  const authTokenHash = typeof raw?.authTokenHash === 'string' && raw.authTokenHash.trim()
    ? raw.authTokenHash.trim()
    : undefined;

  return {
    enabled: raw?.enabled === true,
    host,
    port,
    ...(authTokenHash ? { authTokenHash } : {}),
  };
}

function normalizePort(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }
  return value >= 1 && value <= 65535 ? value : fallback;
}

function normalizeWorkspaceKey(value: string): string {
  return path.resolve(value).replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

export function resolveStoredWorkspaceRoot(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return path.resolve(value.trim());
}

function normalizeRecentWorkspaceRoots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    const workspaceRoot = resolveStoredWorkspaceRoot(entry);
    if (!workspaceRoot) {
      continue;
    }
    const key = normalizeWorkspaceKey(workspaceRoot);
    if (key === normalizeWorkspaceKey(resolveDesktopHomeDirectory())) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(workspaceRoot);
    if (normalized.length >= MAX_RECENT_WORKSPACES) {
      break;
    }
  }

  return normalized;
}

export function mergeRecentWorkspaceRoots(
  existing: string[] | undefined,
  workspaceRoot: string,
): string[] {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const targetKey = normalizeWorkspaceKey(resolvedWorkspaceRoot);
  if (targetKey === normalizeWorkspaceKey(resolveDesktopHomeDirectory())) {
    return normalizeRecentWorkspaceRoots(existing);
  }
  return [
    resolvedWorkspaceRoot,
    ...normalizeRecentWorkspaceRoots(existing).filter(
      (entry) => normalizeWorkspaceKey(entry) !== targetKey,
    ),
  ].slice(0, MAX_RECENT_WORKSPACES);
}

export function removeRecentWorkspaceRoot(
  existing: string[] | undefined,
  workspaceRoot: string,
): string[] {
  const targetKey = normalizeWorkspaceKey(path.resolve(workspaceRoot));
  return normalizeRecentWorkspaceRoots(existing).filter(
    (entry) => normalizeWorkspaceKey(entry) !== targetKey,
  );
}

function resolveSessionPath(filePath: string | undefined): string {
  const candidate = filePath?.trim() ? filePath.trim() : defaultNewSessionPath();
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.join(chatsDirPath(), candidate);
  return absolute.toLowerCase().endsWith('.json') ? absolute : `${absolute}.json`;
}

function deriveDisplayNameFromTimeline(
  timeline: PersistedDesktopTimelineTurnSnapshot[] | undefined,
): string {
  if (!timeline?.length) {
    return 'New conversation';
  }
  const messages = timelinePersistedSnapshotToMessages(timeline);
  const firstUser = messages.find(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  );
  const seed = firstUser?.content ?? 'New conversation';
  return seed.length > 28 ? `${seed.slice(0, 28)}…` : seed;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

