import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { unzipSync } from 'fflate';

import {
  createFileExtensionStateStore,
  EXTENSION_MANIFEST_FILE_NAME,
  resolveExtensionPaths,
  SUPPORTED_EXTENSION_HOST_KINDS,
  type ExtensionHostKind,
  type ExtensionSettingValue,
  type ExtensionStateStore,
  type ExtensionManagementContext,
  type ExtensionPaths,
} from './storage.js';

const EXTENSION_SCHEMA_VERSION = 1;
const EXTENSION_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const TEMP_DIR_PREFIX = 'spirit-extension-';
const EXTENSION_FIELD_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SPIRIT_EXTENSION_FIELD_NAME = 'spiritExtension';

export const SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS = [
  'onStartup',
  'onExtensionInstalled',
  'onSessionOpened',
  'onSessionReset',
  'onUserMessage',
  'onToolCall',
  'onToolResult',
  'onApprovalResolved',
] as const;

export const SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES = [
  'tool-definitions',
  'tool-execution',
  'system-prompt',
  'approval-flow',
  'questions-flow',
  'settings',
  'secret-storage',
  'structured-results',
  'desktop-ui',
  'cli-ui',
] as const;

export const SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES = [
  'allowed',
  'need-approval',
  'need-questions',
] as const;

export const SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES = [
  'foreground',
  'background',
] as const;

export const SUPPORTED_HOST_EXTENSION_SETTING_TYPES = [
  'string',
  'boolean',
  'number',
  'select',
] as const;

export type HostExtensionActivationEventName =
  (typeof SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS)[number];

export type HostExtensionRequestedCapability =
  (typeof SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES)[number];

export type HostExtensionToolApprovalMode =
  (typeof SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES)[number];

export type HostExtensionToolExecutionMode =
  (typeof SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES)[number];

export type HostExtensionSettingType =
  (typeof SUPPORTED_HOST_EXTENSION_SETTING_TYPES)[number];

export type HostExtensionJsonSchema = Record<string, unknown>;

export type HostExtensionSettingDefaultValue = string | boolean | number;
export type HostExtensionSettingsValues = Record<string, ExtensionSettingValue>;

export interface HostExtensionEvent {
  type: HostExtensionActivationEventName;
  detail?: Record<string, unknown>;
}

export interface HostExtensionContributedToolDefinition {
  name: string;
  description: string;
  inputSchema: HostExtensionJsonSchema;
  outputSchema?: HostExtensionJsonSchema;
  approvalMode?: HostExtensionToolApprovalMode;
  executionMode?: HostExtensionToolExecutionMode;
}

export interface HostExtensionContributionSet {
  tools?: HostExtensionContributedToolDefinition[];
  desktop?: HostExtensionDesktopContributionSet;
  cli?: HostExtensionCliContributionSet;
}

export interface HostExtensionDesktopCssDefinition {
  path: string;
  media?: string;
}

export interface HostExtensionDesktopContributionSet {
  css?: HostExtensionDesktopCssDefinition[];
}

export const SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS = [
  'message.user',
  'message.assistant',
  'message.tool',
  'assistant.thinking',
  'input.frame',
  'bottom_form',
  'bottom_form.section',
  'slash_suggestions',
  'approval.panel',
  'questions.panel',
] as const;

export const SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS = [
  'default',
  'accented',
  'muted',
  'warning',
  'success',
  'danger',
] as const;

export const SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES = [
  'default',
  'primary',
  'secondary',
  'muted',
  'accent',
  'success',
  'warning',
  'danger',
] as const;

export type HostExtensionCliUiSlot =
  (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS)[number];

export type HostExtensionCliUiVariant =
  (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS)[number];

export type HostExtensionCliUiTokenRole =
  (typeof SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES)[number];

export interface HostExtensionCliUiHookTokens {
  foreground?: HostExtensionCliUiTokenRole;
  border?: HostExtensionCliUiTokenRole;
  accent?: HostExtensionCliUiTokenRole;
}

export interface HostExtensionCliUiHookDefinition {
  slot: HostExtensionCliUiSlot;
  variant?: HostExtensionCliUiVariant;
  tokens?: HostExtensionCliUiHookTokens;
  prefix?: string;
  suffix?: string;
}

export interface HostExtensionCliContributionSet {
  hooks?: HostExtensionCliUiHookDefinition[];
}

interface HostExtensionManifestParseOptions {
  readRelativeTextFile?: (relativePath: string, fieldName: string) => Promise<string>;
}

export interface HostExtensionSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface HostExtensionSettingDefinition {
  key: string;
  type: HostExtensionSettingType;
  title: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: HostExtensionSettingDefaultValue;
  options?: HostExtensionSettingOption[];
}

export interface HostExtensionSecretSlot {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
}

export interface HostExtensionManifest {
  schemaVersion: number;
  id: string;
  /** 用户可见扩展名，来自 package.json 中的 spiritExtension.displayName。 */
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  /** 声明可安装的宿主（cli / desktop）。 */
  supportedHosts: ExtensionHostKind[];
  activationEvents?: HostExtensionActivationEventName[];
  requestedCapabilities?: HostExtensionRequestedCapability[];
  contributes?: HostExtensionContributionSet;
  settingsSchema?: HostExtensionSettingDefinition[];
  secretSlots?: HostExtensionSecretSlot[];
}

export interface HostExtensionRegistryEntry {
  id: string;
  directoryName: string;
  installedAtUnixMs: number;
  archiveFileName?: string;
}

export interface HostInstalledExtension {
  id: string;
  directoryName: string;
  manifest: HostExtensionManifest;
  directoryPath: string;
  manifestPath: string;
  installedAtUnixMs: number;
  archiveFileName?: string;
}

export interface ImportExtensionArchiveRequest {
  archiveBase64: string;
  fileName?: string;
}

export interface RunExtensionRequest<THostApi> {
  id: string;
  host: THostApi;
  logger?: Pick<Console, 'error' | 'log'>;
}

export interface HostExtensionRuntimeInfo {
  id: string;
  name: string;
  version: string;
  directoryPath: string;
  manifestPath: string;
  main: string;
}

export interface HostExtensionSettingsAccessor {
  get(key: string): Promise<ExtensionSettingValue | undefined>;
  getAll(): Promise<HostExtensionSettingsValues>;
  set(key: string, value: ExtensionSettingValue): Promise<void>;
  setAll(values: HostExtensionSettingsValues): Promise<HostExtensionSettingsValues>;
}

export interface HostExtensionSecretsAccessor {
  get(key: string): Promise<string | undefined>;
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HostExtensionActivationContext<THostApi> {
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  log(message: string): void;
  settings: HostExtensionSettingsAccessor;
  secrets: HostExtensionSecretsAccessor;
  activationEvent?: HostExtensionEvent;
}

export interface HostExtensionToolExecutionContext<THostApi> {
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  toolName: string;
  arguments: Record<string, unknown>;
  log(message: string): void;
  toolCallId?: string;
  questionsResult?: unknown;
}

export type HostExtensionToolHandler<THostApi> = (
  context: HostExtensionToolExecutionContext<THostApi>,
) => Promise<unknown> | unknown;

export interface HostExtensionSystemPromptContribution {
  extensionId: string;
  extensionName: string;
  content: string;
}

export interface CollectExtensionSystemPromptContributionsRequest<THostApi> {
  host: THostApi;
  logger?: Pick<Console, 'error' | 'log'>;
}

export interface HostActivatedExtension {
  tools?: Record<string, HostExtensionToolHandler<unknown>>;
  invokeTool?<THostApi>(request: HostExtensionToolExecutionContext<THostApi>): Promise<unknown> | unknown;
  systemPrompt?: string;
  getSystemPrompt?(): Promise<string | undefined> | string | undefined;
  onEvent?(event: HostExtensionEvent): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface HostResolvedExtensionTool {
  extensionId: string;
  extensionName: string;
  tool: HostExtensionContributedToolDefinition;
}

export interface InvokeExtensionToolRequest<THostApi> {
  extensionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  host: THostApi;
  logger?: Pick<Console, 'error' | 'log'>;
  toolCallId?: string;
  questionsResult?: unknown;
}

export interface UpdateExtensionSettingsRequest {
  id: string;
  values: HostExtensionSettingsValues;
}

export interface UpdateExtensionSecretRequest {
  id: string;
  key: string;
  value?: string;
}

export interface DispatchExtensionEventRequest<THostApi> {
  event: HostExtensionEvent;
  host: THostApi;
  logger?: Pick<Console, 'error' | 'log'>;
  targetExtensionIds?: readonly string[];
}

export interface HostExtensionManager {
  getPaths(): ExtensionPaths;
  list(): Promise<readonly HostInstalledExtension[]>;
  resolveTool(name: string): Promise<HostResolvedExtensionTool | undefined>;
  importArchive(request: ImportExtensionArchiveRequest): Promise<HostInstalledExtension>;
  remove(id: string): Promise<void>;
  run<THostApi>(request: RunExtensionRequest<THostApi>): Promise<void>;
  invokeTool<THostApi>(request: InvokeExtensionToolRequest<THostApi>): Promise<string>;
  getSettingsValues(id: string): Promise<HostExtensionSettingsValues>;
  setSettingsValues(request: UpdateExtensionSettingsRequest): Promise<HostExtensionSettingsValues>;
  getSecretStatus(id: string): Promise<Record<string, boolean>>;
  setSecretValue(request: UpdateExtensionSecretRequest): Promise<Record<string, boolean>>;
  collectSystemPromptContributions<THostApi>(
    request: CollectExtensionSystemPromptContributionsRequest<THostApi>,
  ): Promise<HostExtensionSystemPromptContribution[]>;
  dispatchEvent<THostApi>(request: DispatchExtensionEventRequest<THostApi>): Promise<void>;
  deactivateAll(): Promise<void>;
}

export function collectHostExtensionContributedTools(
  extensions: readonly Pick<HostInstalledExtension, 'manifest'>[],
): HostExtensionContributedToolDefinition[] {
  const collected: HostExtensionContributedToolDefinition[] = [];

  for (const extension of extensions) {
    if (!supportsResolvableToolContribution(extension.manifest)) {
      continue;
    }

    if (!extension.manifest.contributes?.tools?.length) {
      continue;
    }

    collected.push(...extension.manifest.contributes.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
      ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    })));
  }

  return collected;
}

export function createHostExtensionManager(
  context: ExtensionManagementContext,
): HostExtensionManager {
  const activatedExtensions = new Map<string, ActivatedExtensionCacheEntry>();
  const stateStore = context.stateStore ?? createFileExtensionStateStore(context);

  return {
    getPaths() {
      return resolveExtensionPaths(context);
    },
    async list() {
      return listInstalledExtensions(context);
    },
    async resolveTool(name) {
      return resolveExtensionTool(context, name);
    },
    async importArchive(request) {
      return importExtensionArchive(context, request);
    },
    async remove(id) {
      await deactivateExtensionById(activatedExtensions, id);
      await removeInstalledExtension(context, id);
    },
    async run(request) {
      await runInstalledExtension(context, activatedExtensions, stateStore, request);
    },
    async invokeTool(request) {
      return invokeExtensionTool(context, activatedExtensions, stateStore, request);
    },
    async getSettingsValues(id) {
      return loadExtensionSettingsValues(context, stateStore, id);
    },
    async setSettingsValues(request) {
      return saveExtensionSettingsValues(context, stateStore, request);
    },
    async getSecretStatus(id) {
      return loadExtensionSecretStatus(context, stateStore, id);
    },
    async setSecretValue(request) {
      return saveExtensionSecretValue(context, stateStore, request);
    },
    async collectSystemPromptContributions(request) {
      return collectExtensionSystemPromptContributions(
        context,
        activatedExtensions,
        stateStore,
        request,
      );
    },
    async dispatchEvent(request) {
      await dispatchExtensionEvent(context, activatedExtensions, stateStore, request);
    },
    async deactivateAll() {
      await deactivateAllExtensions(activatedExtensions);
    },
  };
}

interface ActivatedExtensionCacheEntry {
  id: string;
  installedAtUnixMs: number;
  activationEvents: readonly HostExtensionActivationEventName[];
  runtimeInfo: HostExtensionRuntimeInfo;
  activatedExtension?: HostActivatedExtension;
  onEvent?: HostActivatedExtension['onEvent'];
  dispose?: HostActivatedExtension['dispose'];
}

export async function listInstalledExtensions(
  context: ExtensionManagementContext,
): Promise<readonly HostInstalledExtension[]> {
  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);

  const registryEntries = await loadExtensionRegistry(paths.extensionsIndexFile);
  const directoryEntries = await readdir(paths.extensionsDir, { withFileTypes: true });
  const installed: HostInstalledExtension[] = [];

  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(paths.extensionsDir, entry.name);
    const manifestPath = path.join(directoryPath, EXTENSION_MANIFEST_FILE_NAME);
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = await readExtensionManifestFile(manifestPath);
      const registryEntry = registryEntries.get(manifest.id);
      const installedAtUnixMs =
        registryEntry?.installedAtUnixMs ?? Math.trunc((await stat(directoryPath)).mtimeMs);

      installed.push({
        id: manifest.id,
        directoryName: entry.name,
        manifest,
        directoryPath,
        manifestPath,
        installedAtUnixMs,
        ...(registryEntry?.archiveFileName
          ? { archiveFileName: registryEntry.archiveFileName }
          : {}),
      });
    } catch {
      continue;
    }
  }

  installed.sort((left, right) => {
    const byName = left.manifest.name.localeCompare(right.manifest.name, 'zh-CN');
    if (byName !== 0) {
      return byName;
    }
    return left.id.localeCompare(right.id, 'en');
  });

  const nextRegistryEntries = installed.map((item) => ({
    id: item.id,
    directoryName: item.directoryName,
    installedAtUnixMs: item.installedAtUnixMs,
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
  }));

  await saveExtensionRegistryIfChanged(paths.extensionsIndexFile, registryEntries, nextRegistryEntries);

  return installed;
}

function assertExtensionImportAllowedForHost(
  manifest: HostExtensionManifest,
  hostKind: ExtensionHostKind,
): void {
  const allowed = manifest.supportedHosts;
  if (allowed.includes(hostKind)) {
    return;
  }
  const hostLabel: Record<ExtensionHostKind, string> = {
    cli: 'CLI',
    desktop: 'Desktop',
  };
  const listed = allowed.map((entry) => hostLabel[entry] ?? entry).join('、');
  throw new Error(
    `此扩展不支持在当前宿主安装：当前为 ${hostLabel[hostKind]}，扩展仅支持 ${listed}。`,
  );
}

export async function importExtensionArchive(
  context: ExtensionManagementContext,
  request: ImportExtensionArchiveRequest,
): Promise<HostInstalledExtension> {
  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);

  const archiveBuffer = Buffer.from(request.archiveBase64, 'base64');
  if (archiveBuffer.length === 0) {
    throw new Error('扩展 ZIP 内容为空。');
  }

  const extracted = unzipSync(new Uint8Array(archiveBuffer));
  const normalizedExtracted = new Map(
    Object.entries(extracted).map(([entryName, content]) => [normalizeArchivePath(entryName), content]),
  );
  const manifestEntryName = resolveManifestArchivePath(Object.keys(extracted));
  const manifestRaw = Buffer.from(normalizedExtracted.get(manifestEntryName) ?? []).toString('utf8');
  const manifestRoot = manifestEntryName.includes('/')
    ? manifestEntryName.slice(0, manifestEntryName.lastIndexOf('/'))
    : '';
  const manifest = await parseExtensionManifest(manifestRaw, {
    readRelativeTextFile: async (relativePath, fieldName) => {
      const normalized = normalizeArchivePath(relativePath);
      const archivePath = manifestRoot ? `${manifestRoot}/${normalized}` : normalized;
      const content = normalizedExtracted.get(archivePath);
      if (!content) {
        throw new Error(`扩展 ${fieldName} 指向的文件不存在：${relativePath}`);
      }
      return Buffer.from(content).toString('utf8');
    },
  });
  assertExtensionImportAllowedForHost(manifest, context.hostKind);
  const directoryName = extensionDirectoryNameFromId(manifest.id);
  const targetDirectory = path.join(paths.extensionsDir, directoryName);

  if (existsSync(targetDirectory)) {
    throw new Error(`扩展已存在，请先删除后再导入：${manifest.id}`);
  }

  const registryEntries = await loadExtensionRegistry(paths.extensionsIndexFile);
  if (registryEntries.has(manifest.id)) {
    throw new Error(`扩展已存在，请先删除后再导入：${manifest.id}`);
  }

  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
  const stagingDirectory = path.join(tempDirectory, directoryName);

  try {
    await mkdir(stagingDirectory, { recursive: true });

    for (const [entryName, content] of Object.entries(extracted)) {
      const relativePath = resolveArchiveRelativePath(entryName, manifestEntryName);
      if (!relativePath) {
        continue;
      }

      const targetFilePath = path.join(stagingDirectory, ...relativePath.split('/'));
      await mkdir(path.dirname(targetFilePath), { recursive: true });
      await writeFile(targetFilePath, Buffer.from(content));
    }

    if (manifest.main) {
      const mainFilePath = path.join(stagingDirectory, ...manifest.main.split('/'));
      if (!existsSync(mainFilePath)) {
        throw new Error(`扩展 main 文件不存在：${manifest.main}`);
      }
    }

    await rename(stagingDirectory, targetDirectory);

    const installedAtUnixMs = Date.now();
    const nextRegistryEntries = [
      ...Array.from(registryEntries.values()),
      {
        id: manifest.id,
        directoryName,
        installedAtUnixMs,
        ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
      },
    ];
    await writeExtensionRegistry(paths.extensionsIndexFile, nextRegistryEntries);

    return {
      id: manifest.id,
      directoryName,
      manifest,
      directoryPath: targetDirectory,
      manifestPath: path.join(targetDirectory, EXTENSION_MANIFEST_FILE_NAME),
      installedAtUnixMs,
      ...(request.fileName?.trim() ? { archiveFileName: request.fileName.trim() } : {}),
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function removeInstalledExtension(
  context: ExtensionManagementContext,
  id: string,
): Promise<void> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error('扩展 id 不能为空。');
  }

  const paths = resolveExtensionPaths(context);
  await ensureExtensionDirectories(paths);
  const installed = await listInstalledExtensions(context);
  const target = installed.find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`未找到扩展：${normalizedId}`);
  }

  await rm(target.directoryPath, { recursive: true, force: true });
  await writeExtensionRegistry(
    paths.extensionsIndexFile,
    installed
      .filter((item) => item.id !== normalizedId)
      .map((item) => ({
        id: item.id,
        directoryName: item.directoryName,
        installedAtUnixMs: item.installedAtUnixMs,
        ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
      })),
  );
}

export async function runInstalledExtension<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: RunExtensionRequest<THostApi>,
): Promise<void> {
  const normalizedId = request.id.trim();
  if (!normalizedId) {
    throw new Error('扩展 id 不能为空。');
  }

  const target = await requireInstalledExtension(context, normalizedId);
  await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });
}

export async function resolveExtensionTool(
  context: ExtensionManagementContext,
  name: string,
): Promise<HostResolvedExtensionTool | undefined> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return undefined;
  }

  const installed = await listInstalledExtensions(context);
  for (const extension of installed) {
    if (!supportsResolvableToolContribution(extension.manifest)) {
      continue;
    }

    const tool = extension.manifest.contributes?.tools?.find((item) => item.name === normalizedName);
    if (!tool) {
      continue;
    }

    return {
      extensionId: extension.id,
      extensionName: extension.manifest.name,
      tool,
    };
  }

  return undefined;
}

export async function invokeExtensionTool<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: InvokeExtensionToolRequest<THostApi>,
): Promise<string> {
  const target = await requireInstalledExtension(context, request.extensionId);
  const tool = target.manifest.contributes?.tools?.find((item) => item.name === request.toolName);
  if (!tool) {
    throw new Error(`扩展未声明工具：${request.toolName}`);
  }
  if (!target.manifest.requestedCapabilities?.includes('tool-execution')) {
    throw new Error(`扩展未声明 tool-execution capability：${target.id}`);
  }

  const entry = await ensureActivatedExtension(target, activatedExtensions, stateStore, {
    host: request.host,
    ...(request.logger ? { logger: request.logger } : {}),
    log: (message) => {
      request.logger?.log(`[extension:${target.id}] ${message}`);
    },
  });

  const result = await invokeActivatedExtensionTool(entry, {
    host: request.host,
    toolName: tool.name,
    arguments: request.arguments,
    ...(request.logger ? { logger: request.logger } : {}),
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.questionsResult !== undefined ? { questionsResult: request.questionsResult } : {}),
  });
  return renderExtensionToolResult(result);
}

export async function loadExtensionSettingsValues(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  id: string,
): Promise<HostExtensionSettingsValues> {
  const extension = await requireInstalledExtension(context, id);
  return loadSettingsValuesForExtension(extension, stateStore);
}

export async function saveExtensionSettingsValues(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  request: UpdateExtensionSettingsRequest,
): Promise<HostExtensionSettingsValues> {
  const extension = await requireInstalledExtension(context, request.id);
  return saveSettingsValuesForExtension(extension, stateStore, request.values);
}

export async function loadExtensionSecretStatus(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  id: string,
): Promise<Record<string, boolean>> {
  const extension = await requireInstalledExtension(context, id);
  const status: Record<string, boolean> = {};

  for (const slot of extension.manifest.secretSlots ?? []) {
    status[slot.key] = await hasExtensionSecret(stateStore, extension.id, slot.key);
  }

  return status;
}

export async function saveExtensionSecretValue(
  context: ExtensionManagementContext,
  stateStore: ExtensionStateStore,
  request: UpdateExtensionSecretRequest,
): Promise<Record<string, boolean>> {
  const extension = await requireInstalledExtension(context, request.id);
  const secretKey = request.key.trim();
  if (!extension.manifest.secretSlots?.some((slot) => slot.key === secretKey)) {
    throw new Error(`扩展未声明 secret slot：${secretKey}`);
  }

  const nextValue = request.value?.trim();
  if (nextValue) {
    if (!stateStore.saveSecret) {
      throw new Error(`当前宿主未实现扩展 secret 存储：${extension.id}`);
    }
    await stateStore.saveSecret(extension.id, secretKey, nextValue);
  } else if (stateStore.deleteSecret) {
    await stateStore.deleteSecret(extension.id, secretKey);
  }

  return loadExtensionSecretStatus(context, stateStore, extension.id);
}

export async function dispatchExtensionEvent<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: DispatchExtensionEventRequest<THostApi>,
): Promise<void> {
  const installed = await listInstalledExtensions(context);
  const targetIds = request.targetExtensionIds
    ? new Set(request.targetExtensionIds.map((id) => id.trim()).filter(Boolean))
    : undefined;

  for (const extension of installed) {
    if (targetIds && !targetIds.has(extension.id)) {
      continue;
    }

    const mainEntry = extension.manifest.main;
    if (!mainEntry) {
      continue;
    }

    const activationEvents = extension.manifest.activationEvents ?? [];
    if (!activationEvents.includes(request.event.type)) {
      continue;
    }

    try {
      const activated = await ensureActivatedExtension(extension, activatedExtensions, stateStore, {
        host: request.host,
        ...(request.logger ? { logger: request.logger } : {}),
        log: (message) => {
          request.logger?.log(`[extension:${extension.id}] ${message}`);
        },
        activationEvent: request.event,
      });
      await activated.onEvent?.(request.event);
    } catch (error) {
      request.logger?.error(`[extension:${extension.id}] event failed`, error);
      throw new Error(
        `扩展事件执行失败：${extension.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}

export async function collectExtensionSystemPromptContributions<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  request: CollectExtensionSystemPromptContributionsRequest<THostApi>,
): Promise<HostExtensionSystemPromptContribution[]> {
  const installed = await listInstalledExtensions(context);
  const contributions: HostExtensionSystemPromptContribution[] = [];

  for (const extension of installed) {
    if (!supportsSystemPromptContribution(extension.manifest) || !extension.manifest.main) {
      continue;
    }

    try {
      const activated = await ensureActivatedExtension(extension, activatedExtensions, stateStore, {
        host: request.host,
        ...(request.logger ? { logger: request.logger } : {}),
        log: (message) => {
          request.logger?.log(`[extension:${extension.id}] ${message}`);
        },
      });
      const content = await resolveActivatedExtensionSystemPrompt(activated.activatedExtension);
      if (!content) {
        continue;
      }

      contributions.push({
        extensionId: extension.id,
        extensionName: extension.manifest.name,
        content,
      });
    } catch (error) {
      request.logger?.error(`[extension:${extension.id}] collect system prompt failed`, error);
    }
  }

  return contributions;
}

async function ensureActivatedExtension<THostApi>(
  target: HostInstalledExtension,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  stateStore: ExtensionStateStore,
  options: {
    host: THostApi;
    logger?: Pick<Console, 'error' | 'log'>;
    log: (message: string) => void;
    activationEvent?: HostExtensionEvent;
  },
): Promise<ActivatedExtensionCacheEntry> {
  const cached = activatedExtensions.get(target.id);
  if (cached && cached.installedAtUnixMs === target.installedAtUnixMs) {
    return cached;
  }

  if (cached?.dispose) {
    await cached.dispose();
    activatedExtensions.delete(target.id);
  }

  const mainEntry = target.manifest.main;
  if (!mainEntry) {
    throw new Error(`扩展未声明 main，当前无法执行：${target.id}`);
  }

  const mainFilePath = path.join(target.directoryPath, ...mainEntry.split('/'));
  if (!existsSync(mainFilePath)) {
    throw new Error(`扩展 main 文件不存在：${mainEntry}`);
  }

  const runtimeInfo = createRuntimeInfo(target);
  const activatedExtension = await activateExtension(target, mainFilePath, {
    host: options.host,
    ...(options.logger ? { logger: options.logger } : {}),
    log: options.log,
    settings: createSettingsAccessor(target, stateStore),
    secrets: createSecretsAccessor(target, stateStore),
    ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
  });

  const next: ActivatedExtensionCacheEntry = {
    id: target.id,
    installedAtUnixMs: target.installedAtUnixMs,
    activationEvents: target.manifest.activationEvents ?? [],
    runtimeInfo,
    ...(activatedExtension ? { activatedExtension } : {}),
    ...(activatedExtension?.onEvent ? { onEvent: activatedExtension.onEvent } : {}),
    ...(activatedExtension?.dispose ? { dispose: activatedExtension.dispose } : {}),
  };
  activatedExtensions.set(target.id, next);
  return next;
}

function createRuntimeInfo(target: HostInstalledExtension): HostExtensionRuntimeInfo {
  return {
    id: target.id,
    name: target.manifest.name,
    version: target.manifest.version,
    directoryPath: target.directoryPath,
    manifestPath: target.manifestPath,
    main: target.manifest.main ?? '',
  };
}

async function invokeActivatedExtensionTool<THostApi>(
  entry: ActivatedExtensionCacheEntry,
  request: {
    host: THostApi;
    toolName: string;
    arguments: Record<string, unknown>;
    logger?: Pick<Console, 'error' | 'log'>;
    toolCallId?: string;
    questionsResult?: unknown;
  },
): Promise<unknown> {
  const activated = entry.activatedExtension;
  if (!activated) {
    throw new Error(`扩展未返回可调用实例：${entry.runtimeInfo.name}`);
  }

  const toolContext: HostExtensionToolExecutionContext<THostApi> = {
    extension: entry.runtimeInfo,
    host: request.host,
    toolName: request.toolName,
    arguments: request.arguments,
    log: (message) => {
      request.logger?.log(`[extension:${entry.id}] ${message}`);
    },
    ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
    ...(request.questionsResult !== undefined ? { questionsResult: request.questionsResult } : {}),
  };

  const directInvoker = activated.invokeTool;
  if (typeof directInvoker === 'function') {
    return directInvoker(toolContext);
  }

  const toolHandler = resolveToolHandler(activated.tools, request.toolName);
  if (!toolHandler) {
    throw new Error(`扩展未导出工具处理器：${request.toolName}`);
  }
  return toolHandler(toolContext);
}

async function resolveActivatedExtensionSystemPrompt(
  activated: HostActivatedExtension | undefined,
): Promise<string | undefined> {
  if (!activated) {
    return undefined;
  }

  if (typeof activated.getSystemPrompt === 'function') {
    const dynamicPrompt = await activated.getSystemPrompt();
    const normalizedDynamicPrompt = dynamicPrompt?.trim();
    return normalizedDynamicPrompt ? normalizedDynamicPrompt : undefined;
  }

  const staticPrompt = activated.systemPrompt?.trim();
  return staticPrompt ? staticPrompt : undefined;
}

function resolveToolHandler(
  tools: HostActivatedExtension['tools'],
  toolName: string,
): HostExtensionToolHandler<unknown> | undefined {
  if (!tools || typeof tools !== 'object') {
    return undefined;
  }

  const handler = tools[toolName];
  return typeof handler === 'function' ? handler : undefined;
}

function renderExtensionToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result === undefined) {
    return '';
  }
  return JSON.stringify(result, null, 2);
}

function createSettingsAccessor(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): HostExtensionSettingsAccessor {
  return {
    async get(key) {
      const values = await loadSettingsValuesForExtension(extension, stateStore);
      return values[key];
    },
    async getAll() {
      return loadSettingsValuesForExtension(extension, stateStore);
    },
    async set(key, value) {
      await saveSettingsValuesForExtension(extension, stateStore, { [key]: value });
    },
    async setAll(values) {
      return saveSettingsValuesForExtension(extension, stateStore, values);
    },
  };
}

function createSecretsAccessor(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): HostExtensionSecretsAccessor {
  return {
    async get(key) {
      assertSecretSlot(extension.manifest, key);
      return stateStore.loadSecret?.(extension.id, key);
    },
    async has(key) {
      assertSecretSlot(extension.manifest, key);
      return hasExtensionSecret(stateStore, extension.id, key);
    },
    async set(key, value) {
      assertSecretSlot(extension.manifest, key);
      if (!stateStore.saveSecret) {
        throw new Error(`当前宿主未实现扩展 secret 存储：${extension.id}`);
      }
      await stateStore.saveSecret(extension.id, key, value);
    },
    async delete(key) {
      assertSecretSlot(extension.manifest, key);
      await stateStore.deleteSecret?.(extension.id, key);
    },
  };
}

async function hasExtensionSecret(
  stateStore: ExtensionStateStore,
  extensionId: string,
  key: string,
): Promise<boolean> {
  if (stateStore.hasSecret) {
    return stateStore.hasSecret(extensionId, key);
  }
  if (stateStore.loadSecret) {
    return Boolean(await stateStore.loadSecret(extensionId, key));
  }
  return false;
}

function assertSecretSlot(manifest: HostExtensionManifest, key: string): void {
  if (!manifest.secretSlots?.some((slot) => slot.key === key)) {
    throw new Error(`扩展未声明 secret slot：${key}`);
  }
}

async function requireInstalledExtension(
  context: ExtensionManagementContext,
  id: string,
): Promise<HostInstalledExtension> {
  const normalizedId = id.trim();
  if (!normalizedId) {
    throw new Error('扩展 id 不能为空。');
  }

  const installed = await listInstalledExtensions(context);
  const target = installed.find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`未找到扩展：${normalizedId}`);
  }
  return target;
}

function normalizeSettingsValues(
  manifest: HostExtensionManifest,
  storedValues: HostExtensionSettingsValues,
): HostExtensionSettingsValues {
  const normalized: HostExtensionSettingsValues = {};

  for (const definition of manifest.settingsSchema ?? []) {
    const candidate = storedValues[definition.key];
    if (candidate !== undefined) {
      normalized[definition.key] = validateSettingValue(definition, candidate, false);
      continue;
    }

    if (definition.defaultValue !== undefined) {
      normalized[definition.key] = definition.defaultValue;
    }
  }

  return normalized;
}

async function loadSettingsValuesForExtension(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
): Promise<HostExtensionSettingsValues> {
  return normalizeSettingsValues(extension.manifest, await stateStore.loadSettings(extension.id));
}

async function saveSettingsValuesForExtension(
  extension: HostInstalledExtension,
  stateStore: ExtensionStateStore,
  incomingValues: HostExtensionSettingsValues,
): Promise<HostExtensionSettingsValues> {
  const currentValues = await stateStore.loadSettings(extension.id);
  const nextValues = mergeSettingsValues(extension.manifest, currentValues, incomingValues);
  await stateStore.saveSettings(extension.id, nextValues);
  return normalizeSettingsValues(extension.manifest, nextValues);
}

function mergeSettingsValues(
  manifest: HostExtensionManifest,
  currentValues: HostExtensionSettingsValues,
  incomingValues: HostExtensionSettingsValues,
): HostExtensionSettingsValues {
  const merged: HostExtensionSettingsValues = { ...currentValues };
  const definitions = new Map((manifest.settingsSchema ?? []).map((item) => [item.key, item]));

  for (const [key, rawValue] of Object.entries(incomingValues)) {
    const definition = definitions.get(key);
    if (!definition) {
      throw new Error(`扩展未声明设置项：${key}`);
    }

    if (rawValue === null) {
      if (definition.required && definition.defaultValue === undefined) {
        throw new Error(`扩展设置 ${key} 为必填，不能清空。`);
      }
      delete merged[key];
      continue;
    }

    merged[key] = validateSettingValue(definition, rawValue, true);
  }

  return merged;
}

function validateSettingValue(
  definition: HostExtensionSettingDefinition,
  value: ExtensionSettingValue,
  allowNull: boolean,
): ExtensionSettingValue {
  if (value === null) {
    if (allowNull) {
      return value;
    }
    throw new Error(`扩展设置 ${definition.key} 不能为空。`);
  }

  if (definition.type === 'string') {
    if (typeof value !== 'string') {
      throw new Error(`扩展设置 ${definition.key} 必须是字符串。`);
    }
    if (definition.required && value.trim().length === 0) {
      throw new Error(`扩展设置 ${definition.key} 不能为空。`);
    }
    return value;
  }

  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error(`扩展设置 ${definition.key} 必须是布尔值。`);
    }
    return value;
  }

  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`扩展设置 ${definition.key} 必须是数字。`);
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw new Error(`扩展设置 ${definition.key} 必须是字符串。`);
  }

  const options = definition.options?.map((option) => option.value) ?? [];
  if (options.length > 0 && !options.includes(value)) {
    throw new Error(`扩展设置 ${definition.key} 取值非法：${value}`);
  }
  return value;
}

function supportsResolvableToolContribution(manifest: HostExtensionManifest): boolean {
  return (
    manifest.requestedCapabilities?.includes('tool-definitions') === true &&
    manifest.requestedCapabilities?.includes('tool-execution') === true
  );
}

function supportsSystemPromptContribution(manifest: HostExtensionManifest): boolean {
  return manifest.requestedCapabilities?.includes('system-prompt') === true;
}


async function deactivateAllExtensions(
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
): Promise<void> {
  for (const entry of activatedExtensions.values()) {
    await entry.dispose?.();
  }
  activatedExtensions.clear();
}

async function deactivateExtensionById(
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
  id: string,
): Promise<void> {
  const normalizedId = id.trim();
  const entry = activatedExtensions.get(normalizedId);
  if (!entry) {
    return;
  }

  await entry.dispose?.();
  activatedExtensions.delete(normalizedId);
}

async function ensureExtensionDirectories(paths: ExtensionPaths): Promise<void> {
  await mkdir(paths.extensionsDir, { recursive: true });
  await mkdir(paths.extensionStateDir, { recursive: true });
  await mkdir(path.dirname(paths.extensionsIndexFile), { recursive: true });
}

async function readExtensionManifestFile(filePath: string): Promise<HostExtensionManifest> {
  const raw = await readFile(filePath, 'utf8');
  const manifestDirectory = path.dirname(filePath);
  return parseExtensionManifest(raw, {
    readRelativeTextFile: async (relativePath, fieldName) => {
      const targetPath = path.join(manifestDirectory, ...normalizeArchivePath(relativePath).split('/'));
      try {
        return await readFile(targetPath, 'utf8');
      } catch {
        throw new Error(`扩展 ${fieldName} 指向的文件不存在：${relativePath}`);
      }
    },
  });
}

async function parseExtensionManifest(
  raw: string,
  options: HostExtensionManifestParseOptions = {},
): Promise<HostExtensionManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('扩展 package.json 不是合法 JSON。');
  }

  if (!isRecord(parsed)) {
    throw new Error('扩展 package.json 必须是 JSON object。');
  }

  const spiritExtension = requiredSpiritExtensionField(parsed[SPIRIT_EXTENSION_FIELD_NAME]);
  const schemaVersion =
    spiritExtension.schemaVersion === undefined
      ? EXTENSION_SCHEMA_VERSION
      : numberField(spiritExtension.schemaVersion, `${SPIRIT_EXTENSION_FIELD_NAME}.schemaVersion`);
  if (schemaVersion !== EXTENSION_SCHEMA_VERSION) {
    throw new Error(
      `仅支持 ${SPIRIT_EXTENSION_FIELD_NAME}.schemaVersion=${EXTENSION_SCHEMA_VERSION} 的扩展 package.json。`,
    );
  }

  const id = packageNameField(parsed.name);
  const name = stringField(spiritExtension.displayName, `${SPIRIT_EXTENSION_FIELD_NAME}.displayName`);
  const version = stringField(parsed.version, 'version');
  const description = optionalPackageStringField(parsed.description, 'description');
  const author = optionalPackageAuthorField(parsed.author);
  const homepage = optionalPackageStringField(parsed.homepage, 'homepage');
  const main = optionalPackageStringField(parsed.main, 'main');
  const activationEvents = optionalActivationEventsField(
    spiritExtension.activationEvents,
    `${SPIRIT_EXTENSION_FIELD_NAME}.activationEvents`,
  );
  const requestedCapabilities = optionalRequestedCapabilitiesField(
    spiritExtension.requestedCapabilities,
    `${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities`,
  );
  const contributes = await optionalContributionSetField(
    spiritExtension.contributes,
    options,
    `${SPIRIT_EXTENSION_FIELD_NAME}.contributes`,
  );
  const settingsSchema = optionalSettingsSchemaField(
    spiritExtension.settingsSchema,
    `${SPIRIT_EXTENSION_FIELD_NAME}.settingsSchema`,
  );
  const secretSlots = optionalSecretSlotsField(
    spiritExtension.secretSlots,
    `${SPIRIT_EXTENSION_FIELD_NAME}.secretSlots`,
  );
  const supportedHosts = requiredSupportedHostsField(
    spiritExtension.supportedHosts,
    `${SPIRIT_EXTENSION_FIELD_NAME}.supportedHosts`,
  );

  if (main) {
    assertSafeRelativePath(main, 'main');
  }

  assertHostUiContributionCapabilities(requestedCapabilities, contributes);

  return {
    schemaVersion,
    id,
    name,
    version,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(main ? { main } : {}),
    supportedHosts,
    ...(activationEvents.length > 0 ? { activationEvents } : {}),
    ...(requestedCapabilities.length > 0 ? { requestedCapabilities } : {}),
    ...(contributes ? { contributes } : {}),
    ...(settingsSchema.length > 0 ? { settingsSchema } : {}),
    ...(secretSlots.length > 0 ? { secretSlots } : {}),
  };
}

async function loadExtensionRegistry(filePath: string): Promise<Map<string, HostExtensionRegistryEntry>> {
  if (!existsSync(filePath)) {
    return new Map();
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: HostExtensionRegistryEntry[] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return new Map(
      entries
        .filter((entry) => typeof entry?.id === 'string' && typeof entry?.directoryName === 'string')
        .map((entry) => [entry.id, entry]),
    );
  } catch {
    return new Map();
  }
}

async function saveExtensionRegistryIfChanged(
  filePath: string,
  currentEntries: ReadonlyMap<string, HostExtensionRegistryEntry>,
  nextEntries: readonly HostExtensionRegistryEntry[],
): Promise<void> {
  const currentJson = serializeRegistry(Array.from(currentEntries.values()));
  const nextJson = serializeRegistry(nextEntries);
  if (currentJson === nextJson) {
    return;
  }

  await writeFile(filePath, nextJson, 'utf8');
}

async function writeExtensionRegistry(
  filePath: string,
  entries: readonly HostExtensionRegistryEntry[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeRegistry(entries), 'utf8');
}

function serializeRegistry(entries: readonly HostExtensionRegistryEntry[]): string {
  const sorted = [...entries].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return `${JSON.stringify({ entries: sorted }, null, 2)}\n`;
}

function resolveManifestArchivePath(entryNames: readonly string[]): string {
  const candidates = entryNames.filter((entryName) => {
    const normalized = normalizeArchivePath(entryName);
    return normalized.endsWith(`/${EXTENSION_MANIFEST_FILE_NAME}`) || normalized === EXTENSION_MANIFEST_FILE_NAME;
  });

  if (candidates.length === 0) {
    throw new Error(`扩展 ZIP 中缺少 ${EXTENSION_MANIFEST_FILE_NAME}。`);
  }

  if (candidates.length > 1) {
    throw new Error(`扩展 ZIP 中包含多个 ${EXTENSION_MANIFEST_FILE_NAME}。`);
  }

  const manifestPath = candidates[0];
  if (!manifestPath) {
    throw new Error(`扩展 ZIP 中缺少 ${EXTENSION_MANIFEST_FILE_NAME}。`);
  }

  return normalizeArchivePath(manifestPath);
}

function resolveArchiveRelativePath(entryName: string, manifestEntryName: string): string | undefined {
  const normalizedEntryName = normalizeArchivePath(entryName);
  const manifestRoot = manifestEntryName.includes('/')
    ? manifestEntryName.slice(0, manifestEntryName.lastIndexOf('/'))
    : '';

  if (manifestRoot) {
    if (!normalizedEntryName.startsWith(`${manifestRoot}/`)) {
      return undefined;
    }
  }

  const relativePath = manifestRoot
    ? normalizedEntryName.slice(manifestRoot.length + 1)
    : normalizedEntryName;

  if (!relativePath || relativePath.endsWith('/')) {
    return undefined;
  }

  assertSafeRelativePath(relativePath, 'archive entry');
  return relativePath;
}

function normalizeArchivePath(filePath: string): string {
  return filePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function extensionDirectoryNameFromId(id: string): string {
  return `pkg-${Buffer.from(id, 'utf8').toString('base64url')}`;
}

async function activateExtension<THostApi>(
  target: HostInstalledExtension,
  mainFilePath: string,
  options: {
    host: THostApi;
    logger?: Pick<Console, 'error' | 'log'>;
    log: (message: string) => void;
    settings: HostExtensionSettingsAccessor;
    secrets: HostExtensionSecretsAccessor;
    activationEvent?: HostExtensionEvent;
  },
): Promise<HostActivatedExtension | undefined> {
  const loadedModule = await loadExtensionModule(target, mainFilePath, options.logger);
  const activate = resolveActivateHandler<THostApi>(loadedModule);
  if (!activate) {
    throw new Error(
      `扩展 ${target.manifest.name} 未导出 activate；请导出 activate(context) 或默认导出该函数。`,
    );
  }

  try {
    const activationResult = await activate({
      extension: {
        id: target.id,
        name: target.manifest.name,
        version: target.manifest.version,
        directoryPath: target.directoryPath,
        manifestPath: target.manifestPath,
        main: target.manifest.main ?? '',
      },
      host: options.host,
      log: options.log,
      settings: options.settings,
      secrets: options.secrets,
      ...(options.activationEvent ? { activationEvent: options.activationEvent } : {}),
    });

    return resolveActivatedExtension(activationResult) ?? resolveActivatedExtension(loadedModule);
  } catch (error) {
    options.logger?.error(`[extension:${target.id}] activate failed`, error);
    throw new Error(
      `执行扩展失败：${target.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function loadExtensionModule(
  target: HostInstalledExtension,
  mainFilePath: string,
  logger?: Pick<Console, 'error' | 'log'>,
): Promise<unknown> {
  try {
    const mainModuleUrl = pathToFileURL(mainFilePath);
    mainModuleUrl.searchParams.set('ts', `${target.installedAtUnixMs}`);
    return await import(mainModuleUrl.href);
  } catch (error) {
    logger?.error(`[extension:${target.id}] load failed`, error);
    throw new Error(
      `加载扩展失败：${target.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function resolveActivatedExtension(value: unknown): HostActivatedExtension | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tools = resolveActivatedExtensionTools(value.tools);
  const invokeTool = typeof value.invokeTool === 'function'
    ? value.invokeTool as HostActivatedExtension['invokeTool']
    : undefined;
  const systemPrompt = typeof value.systemPrompt === 'string' && value.systemPrompt.trim()
    ? value.systemPrompt
    : undefined;
  const getSystemPrompt = typeof value.getSystemPrompt === 'function'
    ? value.getSystemPrompt as HostActivatedExtension['getSystemPrompt']
    : undefined;
  const onEvent = typeof value.onEvent === 'function' ? value.onEvent : undefined;
  const dispose = typeof value.dispose === 'function' ? value.dispose : undefined;
  if (!tools && !invokeTool && !systemPrompt && !getSystemPrompt && !onEvent && !dispose) {
    return undefined;
  }

  return Object.assign(
    {},
    tools ? { tools } : {},
    invokeTool ? { invokeTool } : {},
    systemPrompt ? { systemPrompt } : {},
    getSystemPrompt ? { getSystemPrompt } : {},
    onEvent ? { onEvent: onEvent as HostActivatedExtension['onEvent'] } : {},
    dispose ? { dispose: dispose as HostActivatedExtension['dispose'] } : {},
  ) as HostActivatedExtension;
}

function resolveActivatedExtensionTools(
  value: unknown,
): HostActivatedExtension['tools'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(([, handler]) => typeof handler === 'function');
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as HostActivatedExtension['tools'];
}

function resolveActivateHandler<THostApi>(
  loadedModule: unknown,
): ((context: HostExtensionActivationContext<THostApi>) => unknown) | undefined {
  if (typeof loadedModule === 'function') {
    return loadedModule as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  if (!isRecord(loadedModule)) {
    return undefined;
  }

  if (typeof loadedModule.activate === 'function') {
    return loadedModule.activate as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  const defaultExport = loadedModule.default;
  if (typeof defaultExport === 'function') {
    return defaultExport as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  if (isRecord(defaultExport) && typeof defaultExport.activate === 'function') {
    return defaultExport.activate as (context: HostExtensionActivationContext<THostApi>) => unknown;
  }

  return undefined;
}

function assertSafeRelativePath(filePath: string, label: string): void {
  const normalized = normalizeArchivePath(filePath);
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error(`扩展 ${label} 必须是相对路径。`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`扩展 ${label} 包含非法路径段。`);
  }
}

function requiredSpiritExtensionField(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`扩展 package.json 缺少 ${SPIRIT_EXTENSION_FIELD_NAME} 字段，且该字段必须是对象。`);
  }
  return value;
}

function packageNameField(value: unknown): string {
  const packageName = stringField(value, 'name');
  if (!EXTENSION_PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(
      '扩展 package.json 字段 name 非法；必须为合法 npm 包名，且本次仅支持小写包名与可选 scoped 包名。',
    );
  }
  return packageName;
}

function optionalPackageStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`扩展 package.json 字段 ${fieldName} 必须是字符串。`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalPackageAuthorField(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isRecord(value)) {
    return optionalPackageStringField(value.name, 'author.name');
  }
  throw new Error('扩展 package.json 字段 author 必须是字符串或包含 name 字段的对象。');
}

function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`扩展字段 ${fieldName} 不能为空。`);
  }
  return value.trim();
}

function optionalStringField(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredSupportedHostsField(value: unknown, fieldName: string): ExtensionHostKind[] {
  if (value === undefined || value === null) {
    throw new Error(`扩展字段 ${fieldName} 缺失；须为非空数组，元素为 cli 与/或 desktop。`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`扩展字段 ${fieldName} 必须是字符串数组。`);
  }
  if (value.length === 0) {
    throw new Error(`扩展字段 ${fieldName} 须至少包含一项（cli 或 desktop）。`);
  }

  const result: ExtensionHostKind[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`扩展字段 ${fieldName} 必须是字符串数组。`);
    }
    const normalized = entry.trim() as ExtensionHostKind;
    if (!SUPPORTED_EXTENSION_HOST_KINDS.includes(normalized)) {
      throw new Error(`扩展字段 ${fieldName} 取值非法：${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function optionalActivationEventsField(
  value: unknown,
  fieldName: string,
): HostExtensionActivationEventName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HostExtensionActivationEventName[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`扩展字段 ${fieldName} 必须是字符串数组。`);
    }
    const normalized = entry.trim() as HostExtensionActivationEventName;
    if (!SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS.includes(normalized)) {
      throw new Error(`扩展字段 ${fieldName} 取值非法：${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function optionalRequestedCapabilitiesField(
  value: unknown,
  fieldName: string,
): HostExtensionRequestedCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HostExtensionRequestedCapability[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error(`扩展字段 ${fieldName} 必须是字符串数组。`);
    }
    const normalized = entry.trim() as HostExtensionRequestedCapability;
    if (!SUPPORTED_HOST_EXTENSION_REQUESTED_CAPABILITIES.includes(normalized)) {
      throw new Error(`扩展字段 ${fieldName} 取值非法：${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

async function optionalContributionSetField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionContributionSet | undefined> {
  if (!isRecord(value)) {
    return undefined;
  }

  const tools = optionalContributedToolsField(value.tools, `${fieldPrefix}.tools`);
  const desktop = optionalDesktopContributionSetField(value.desktop, `${fieldPrefix}.desktop`);
  const cli = await optionalCliContributionSetField(value.cli, options, `${fieldPrefix}.cli`);
  if (tools.length === 0 && !desktop && !cli) {
    return undefined;
  }

  return {
    ...(tools.length > 0 ? { tools } : {}),
    ...(desktop ? { desktop } : {}),
    ...(cli ? { cli } : {}),
  };
}

function optionalContributedToolsField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionContributedToolDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseContributedToolDefinition(entry, index, fieldPrefix));
}

function optionalDesktopContributionSetField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionDesktopContributionSet | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const css = optionalDesktopCssDefinitionsField(value.css, `${fieldPrefix}.css`);
  if (css.length === 0) {
    return undefined;
  }

  return { css };
}

function optionalDesktopCssDefinitionsField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionDesktopCssDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseDesktopCssDefinition(entry, index, fieldPrefix));
}

async function optionalCliContributionSetField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionCliContributionSet | undefined> {
  if (!isRecord(value)) {
    return undefined;
  }

  const hooks = await optionalCliUiHookDefinitionsField(value.hooks, options, `${fieldPrefix}.hooks`);
  if (hooks.length === 0) {
    return undefined;
  }

  return { hooks };
}

async function optionalCliUiHookDefinitionsField(
  value: unknown,
  options: HostExtensionManifestParseOptions,
  fieldPrefix: string,
): Promise<HostExtensionCliUiHookDefinition[]> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldPrefix} 必须是对象，且必须使用 path 引用外置资源文件。`);
  }

  const hooksPath = stringField(value.path, `${fieldPrefix}.path`);
  assertSafeRelativePath(hooksPath, `${fieldPrefix}.path`);
  const readRelativeTextFile = options.readRelativeTextFile;
  if (!readRelativeTextFile) {
    throw new Error(`当前上下文不支持读取扩展 ${fieldPrefix}.path：${hooksPath}`);
  }

  const raw = await readRelativeTextFile(hooksPath, `${fieldPrefix}.path`);
  return parseCliUiHookDocument(raw, hooksPath);
}

function parseCliUiHookDocument(
  raw: string,
  resourcePath: string,
): HostExtensionCliUiHookDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`扩展 CLI hooks 资源不是合法 JSON：${resourcePath}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.hooks)) {
    throw new Error(`扩展 CLI hooks 资源必须是形如 { \"hooks\": [...] } 的对象：${resourcePath}`);
  }

  return parsed.hooks.map((entry, index) =>
    parseCliUiHookDefinition(entry, index, `CLI hooks 资源 ${resourcePath}.hooks`)
  );
}

function parseCliUiHookDefinition(
  value: unknown,
  index: number,
  fieldPrefix = 'contributes.cli.hooks',
): HostExtensionCliUiHookDefinition {
  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldPrefix}[${index}] 必须是对象。`);
  }

  const slot = enumField(
    value.slot,
    `${fieldPrefix}[${index}].slot`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_SLOTS,
  );
  const variant = optionalEnumField(
    value.variant,
    `${fieldPrefix}[${index}].variant`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_VARIANTS,
  );
  const tokens = optionalCliUiHookTokensField(value.tokens, `${fieldPrefix}[${index}].tokens`);
  const prefix = optionalStringField(value.prefix);
  const suffix = optionalStringField(value.suffix);

  return {
    slot,
    ...(variant ? { variant } : {}),
    ...(tokens ? { tokens } : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

function optionalCliUiHookTokensField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionCliUiHookTokens | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const foreground = optionalEnumField(
    value.foreground,
    `${fieldPrefix}.foreground`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );
  const border = optionalEnumField(
    value.border,
    `${fieldPrefix}.border`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );
  const accent = optionalEnumField(
    value.accent,
    `${fieldPrefix}.accent`,
    SUPPORTED_HOST_EXTENSION_CLI_UI_TOKEN_ROLES,
  );

  if (!foreground && !border && !accent) {
    return undefined;
  }

  return {
    ...(foreground ? { foreground } : {}),
    ...(border ? { border } : {}),
    ...(accent ? { accent } : {}),
  };
}

function parseDesktopCssDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionDesktopCssDefinition {
  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldPrefix}[${index}] 必须是对象。`);
  }

  const cssPath = stringField(value.path, `${fieldPrefix}[${index}].path`);
  assertSafeRelativePath(cssPath, `${fieldPrefix}[${index}].path`);
  const media = optionalStringField(value.media);

  return {
    path: cssPath,
    ...(media ? { media } : {}),
  };
}

function assertHostUiContributionCapabilities(
  requestedCapabilities: readonly HostExtensionRequestedCapability[],
  contributes: HostExtensionContributionSet | undefined,
): void {
  const hasDesktopContribution = Boolean(contributes?.desktop);
  const hasCliContribution = Boolean(contributes?.cli);
  const hasDesktopCapability = requestedCapabilities.includes('desktop-ui');
  const hasCliCapability = requestedCapabilities.includes('cli-ui');

  if (hasDesktopContribution !== hasDesktopCapability) {
    throw new Error(
      hasDesktopContribution
        ? `扩展声明了 ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.desktop，但缺少 ${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities 中的 desktop-ui。`
        : `扩展声明了 desktop-ui capability，但缺少 ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.desktop。`
    );
  }

  if (hasCliContribution !== hasCliCapability) {
    throw new Error(
      hasCliContribution
        ? `扩展声明了 ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.cli，但缺少 ${SPIRIT_EXTENSION_FIELD_NAME}.requestedCapabilities 中的 cli-ui。`
        : `扩展声明了 cli-ui capability，但缺少 ${SPIRIT_EXTENSION_FIELD_NAME}.contributes.cli。`
    );
  }
}

function parseContributedToolDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionContributedToolDefinition {
  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldPrefix}[${index}] 必须是对象。`);
  }

  const name = stringField(value.name, `${fieldPrefix}[${index}].name`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(name)) {
    throw new Error(`扩展工具名非法：${name}`);
  }

  const description = stringField(value.description, `${fieldPrefix}[${index}].description`);
  const inputSchema = schemaField(value.inputSchema, `${fieldPrefix}[${index}].inputSchema`);
  const outputSchema = optionalSchemaField(value.outputSchema, `${fieldPrefix}[${index}].outputSchema`);
  const approvalMode = optionalEnumField(
    value.approvalMode,
    `${fieldPrefix}[${index}].approvalMode`,
    SUPPORTED_HOST_EXTENSION_TOOL_APPROVAL_MODES,
  );
  const executionMode = optionalEnumField(
    value.executionMode,
    `${fieldPrefix}[${index}].executionMode`,
    SUPPORTED_HOST_EXTENSION_TOOL_EXECUTION_MODES,
  );

  return {
    name,
    description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(approvalMode ? { approvalMode } : {}),
    ...(executionMode ? { executionMode } : {}),
  };
}

function optionalSettingsSchemaField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionSettingDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => parseSettingDefinition(entry, index, fieldPrefix));
}

function parseSettingDefinition(
  value: unknown,
  index: number,
  fieldPrefix: string,
): HostExtensionSettingDefinition {
  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldPrefix}[${index}] 必须是对象。`);
  }

  const key = stringField(value.key, `${fieldPrefix}[${index}].key`);
  if (!EXTENSION_FIELD_KEY_PATTERN.test(key)) {
    throw new Error(`扩展设置键非法：${key}`);
  }

  const type = enumField(
    value.type,
    `${fieldPrefix}[${index}].type`,
    SUPPORTED_HOST_EXTENSION_SETTING_TYPES,
  );
  const title = stringField(value.title, `${fieldPrefix}[${index}].title`);
  const description = optionalStringField(value.description);
  const placeholder = optionalStringField(value.placeholder);
  const required = optionalBooleanField(value.required);
  const defaultValue = optionalSettingDefaultValueField(
    value.defaultValue,
    `${fieldPrefix}[${index}].defaultValue`,
    type,
  );
  const options = optionalSettingOptionsField(value.options, index, type, `${fieldPrefix}[${index}].options`);

  return {
    key,
    type,
    title,
    ...(description ? { description } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(required !== undefined ? { required } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(options.length > 0 ? { options } : {}),
  };
}

function optionalSettingOptionsField(
  value: unknown,
  settingIndex: number,
  type: HostExtensionSettingType,
  fieldName: string,
): HostExtensionSettingOption[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (type !== 'select') {
    throw new Error(`只有 select 类型的设置项允许声明 options：${fieldName.replace(/\.options$/u, '')}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`扩展字段 ${fieldName} 必须是数组。`);
  }

  return value.map((entry, optionIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`扩展字段 ${fieldName}[${optionIndex}] 必须是对象。`);
    }
    const optionValue = stringField(
      entry.value,
      `${fieldName}[${optionIndex}].value`,
    );
    const label = stringField(
      entry.label,
      `${fieldName}[${optionIndex}].label`,
    );
    const description = optionalStringField(entry.description);
    return {
      value: optionValue,
      label,
      ...(description ? { description } : {}),
    };
  });
}

function optionalSettingDefaultValueField(
  value: unknown,
  fieldName: string,
  type: HostExtensionSettingType,
): HostExtensionSettingDefaultValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (type) {
    case 'string':
    case 'select':
      if (typeof value !== 'string') {
        throw new Error(`扩展字段 ${fieldName} 必须是字符串。`);
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`扩展字段 ${fieldName} 必须是布尔值。`);
      }
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`扩展字段 ${fieldName} 必须是数字。`);
      }
      return value;
  }
}

function optionalSecretSlotsField(
  value: unknown,
  fieldPrefix: string,
): HostExtensionSecretSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`扩展字段 ${fieldPrefix}[${index}] 必须是对象。`);
    }
    const key = stringField(entry.key, `${fieldPrefix}[${index}].key`);
    if (!EXTENSION_FIELD_KEY_PATTERN.test(key)) {
      throw new Error(`扩展 secret slot 键非法：${key}`);
    }
    const title = stringField(entry.title, `${fieldPrefix}[${index}].title`);
    const description = optionalStringField(entry.description);
    const required = optionalBooleanField(entry.required);
    return {
      key,
      title,
      ...(description ? { description } : {}),
      ...(required !== undefined ? { required } : {}),
    };
  });
}

function optionalBooleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function schemaField(value: unknown, fieldName: string): HostExtensionJsonSchema {
  if (!isRecord(value)) {
    throw new Error(`扩展字段 ${fieldName} 必须是对象。`);
  }
  return value;
}

function optionalSchemaField(
  value: unknown,
  fieldName: string,
): HostExtensionJsonSchema | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return schemaField(value, fieldName);
}

function enumField<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
): T[number] {
  if (typeof value !== 'string') {
    throw new Error(`扩展字段 ${fieldName} 必须是字符串。`);
  }
  const normalized = value.trim() as T[number];
  if (!allowedValues.includes(normalized)) {
    throw new Error(`扩展字段 ${fieldName} 取值非法：${value}`);
  }
  return normalized;
}

function optionalEnumField<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T,
): T[number] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return enumField(value, fieldName, allowedValues);
}

function numberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`扩展字段 ${fieldName} 必须是数字。`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
