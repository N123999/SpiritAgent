import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { unzipSync } from 'fflate';

import {
  EXTENSION_MANIFEST_FILE_NAME,
  resolveExtensionPaths,
  type ExtensionManagementContext,
  type ExtensionPaths,
} from './storage.js';

const EXTENSION_SCHEMA_VERSION = 1;
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const TEMP_DIR_PREFIX = 'spirit-extension-';

export const SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS = [
  'onStartup',
  'onExtensionInstalled',
  'onSessionOpened',
  'onSessionReset',
  'onUserMessage',
] as const;

export type HostExtensionActivationEventName =
  (typeof SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS)[number];

export interface HostExtensionEvent {
  type: HostExtensionActivationEventName;
  detail?: Record<string, unknown>;
}

export interface HostExtensionManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  activationEvents?: HostExtensionActivationEventName[];
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

export interface HostExtensionActivationContext<THostApi> {
  extension: HostExtensionRuntimeInfo;
  host: THostApi;
  log(message: string): void;
  activationEvent?: HostExtensionEvent;
}

export interface HostActivatedExtension {
  onEvent?(event: HostExtensionEvent): Promise<void> | void;
  dispose?(): Promise<void> | void;
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
  importArchive(request: ImportExtensionArchiveRequest): Promise<HostInstalledExtension>;
  remove(id: string): Promise<void>;
  run<THostApi>(request: RunExtensionRequest<THostApi>): Promise<void>;
  dispatchEvent<THostApi>(request: DispatchExtensionEventRequest<THostApi>): Promise<void>;
  deactivateAll(): Promise<void>;
}

export function createHostExtensionManager(
  context: ExtensionManagementContext,
): HostExtensionManager {
  const activatedExtensions = new Map<string, ActivatedExtensionCacheEntry>();

  return {
    getPaths() {
      return resolveExtensionPaths(context);
    },
    async list() {
      return listInstalledExtensions(context);
    },
    async importArchive(request) {
      return importExtensionArchive(context, request);
    },
    async remove(id) {
      await deactivateExtensionById(activatedExtensions, id);
      await removeInstalledExtension(context, id);
    },
    async run(request) {
      await runInstalledExtension(context, request);
    },
    async dispatchEvent(request) {
      await dispatchExtensionEvent(context, activatedExtensions, request);
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
  const manifestEntryName = resolveManifestArchivePath(Object.keys(extracted));
  const manifestRaw = Buffer.from(extracted[manifestEntryName] ?? []).toString('utf8');
  const manifest = parseExtensionManifest(manifestRaw);
  const directoryName = manifest.id;
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
  request: RunExtensionRequest<THostApi>,
): Promise<void> {
  const normalizedId = request.id.trim();
  if (!normalizedId) {
    throw new Error('扩展 id 不能为空。');
  }

  const installed = await listInstalledExtensions(context);
  const target = installed.find((item) => item.id === normalizedId);
  if (!target) {
    throw new Error(`未找到扩展：${normalizedId}`);
  }

  const mainEntry = target.manifest.main;
  if (!mainEntry) {
    throw new Error(`扩展未声明 main，当前无法执行：${normalizedId}`);
  }

  const mainFilePath = path.join(target.directoryPath, ...mainEntry.split('/'));
  if (!existsSync(mainFilePath)) {
    throw new Error(`扩展 main 文件不存在：${mainEntry}`);
  }

  const logger = request.logger;
  const log = (message: string) => {
    logger?.log(`[extension:${target.id}] ${message}`);
  };

  await activateExtension(target, mainFilePath, {
    host: request.host,
    ...(logger ? { logger } : {}),
    log,
  });
}

export async function dispatchExtensionEvent<THostApi>(
  context: ExtensionManagementContext,
  activatedExtensions: Map<string, ActivatedExtensionCacheEntry>,
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

    const cached = activatedExtensions.get(extension.id);
    if (cached) {
      try {
        await cached.onEvent?.(request.event);
      } catch (error) {
        request.logger?.error(`[extension:${extension.id}] event failed`, error);
        throw new Error(
          `扩展事件执行失败：${extension.manifest.name} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      continue;
    }

    const mainFilePath = path.join(extension.directoryPath, ...mainEntry.split('/'));
    if (!existsSync(mainFilePath)) {
      throw new Error(`扩展 main 文件不存在：${mainEntry}`);
    }

    const activated = await activateExtension(extension, mainFilePath, {
      host: request.host,
      ...(request.logger ? { logger: request.logger } : {}),
      log: (message) => {
        request.logger?.log(`[extension:${extension.id}] ${message}`);
      },
      activationEvent: request.event,
    });
    activatedExtensions.set(extension.id, {
      id: extension.id,
      installedAtUnixMs: extension.installedAtUnixMs,
      activationEvents,
      ...(activated?.onEvent ? { onEvent: activated.onEvent } : {}),
      ...(activated?.dispose ? { dispose: activated.dispose } : {}),
    });
  }
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
  await mkdir(path.dirname(paths.extensionsIndexFile), { recursive: true });
}

async function readExtensionManifestFile(filePath: string): Promise<HostExtensionManifest> {
  const raw = await readFile(filePath, 'utf8');
  return parseExtensionManifest(raw);
}

function parseExtensionManifest(raw: string): HostExtensionManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('扩展 manifest 不是合法 JSON。');
  }

  if (!isRecord(parsed)) {
    throw new Error('扩展 manifest 必须是 JSON object。');
  }

  const schemaVersion =
    parsed.schemaVersion === undefined ? EXTENSION_SCHEMA_VERSION : numberField(parsed.schemaVersion, 'schemaVersion');
  if (schemaVersion !== EXTENSION_SCHEMA_VERSION) {
    throw new Error(`仅支持 schemaVersion=${EXTENSION_SCHEMA_VERSION} 的扩展 manifest。`);
  }

  const id = stringField(parsed.id, 'id');
  if (!EXTENSION_ID_PATTERN.test(id)) {
    throw new Error('扩展 id 只能包含小写字母、数字、点、下划线或中划线。');
  }

  const name = stringField(parsed.name, 'name');
  const version = stringField(parsed.version, 'version');
  const description = optionalStringField(parsed.description);
  const author = optionalStringField(parsed.author);
  const homepage = optionalStringField(parsed.homepage);
  const main = optionalStringField(parsed.main);
  const activationEvents = optionalActivationEventsField(parsed.activationEvents);

  if (main) {
    assertSafeRelativePath(main, 'main');
  }

  return {
    schemaVersion,
    id,
    name,
    version,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    ...(main ? { main } : {}),
    ...(activationEvents.length > 0 ? { activationEvents } : {}),
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

async function activateExtension<THostApi>(
  target: HostInstalledExtension,
  mainFilePath: string,
  options: {
    host: THostApi;
    logger?: Pick<Console, 'error' | 'log'>;
    log: (message: string) => void;
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

  const onEvent = typeof value.onEvent === 'function' ? value.onEvent : undefined;
  const dispose = typeof value.dispose === 'function' ? value.dispose : undefined;
  if (!onEvent && !dispose) {
    return undefined;
  }

  return Object.assign(
    {},
    onEvent ? { onEvent: onEvent as HostActivatedExtension['onEvent'] } : {},
    dispose ? { dispose: dispose as HostActivatedExtension['dispose'] } : {},
  ) as HostActivatedExtension;
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

function stringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`扩展 manifest 字段 ${fieldName} 不能为空。`);
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

function optionalActivationEventsField(value: unknown): HostExtensionActivationEventName[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: HostExtensionActivationEventName[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new Error('扩展 manifest 字段 activationEvents 必须是字符串数组。');
    }
    const normalized = entry.trim() as HostExtensionActivationEventName;
    if (!SUPPORTED_HOST_EXTENSION_ACTIVATION_EVENTS.includes(normalized)) {
      throw new Error(`不支持的扩展 activation event：${entry}`);
    }
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }

  return result;
}

function numberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`扩展 manifest 字段 ${fieldName} 必须是数字。`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}