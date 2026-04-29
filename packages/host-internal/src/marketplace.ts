import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { x as extractTar } from 'tar';

import {
  installPreparedExtensionDirectory,
  type HostInstalledExtension,
} from './extensions.js';
import type { ExtensionHostKind, ExtensionManagementContext } from './storage.js';

const MARKETPLACE_TEMP_DIR_PREFIX = 'spirit-marketplace-';
export const DEFAULT_MARKETPLACE_REGISTRY_BASE_URL =
  'https://raw.githubusercontent.com/N123999/awesome-SpiritAgent/refs/heads/main/registry/';

export type MarketplaceChannel = 'stable' | 'preview' | 'experimental';
export type MarketplaceReviewStatus = 'unverified' | 'verified' | 'revoked';

export interface MarketplaceCatalogItem {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  defaultChannel: MarketplaceChannel;
  defaultReviewStatus: MarketplaceReviewStatus;
  detailPath: string;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: ExtensionHostKind[];
  requestedCapabilities: string[];
  iconUrl?: string;
}

export interface MarketplaceVersionChangelog {
  summary: string;
  body: string;
}

export interface MarketplaceDetailVersion {
  version: string;
  channel: MarketplaceChannel;
  reviewStatus: MarketplaceReviewStatus;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: ExtensionHostKind[];
  requestedCapabilities: string[];
  iconUrl?: string;
  publishedAt?: string;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  changelog?: MarketplaceVersionChangelog;
}

export interface MarketplaceDetail {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  readmePath: string;
  versions: MarketplaceDetailVersion[];
}

export interface MarketplacePreparedInstall {
  extensionId: string;
  packageName: string;
  displayName: string;
  description: string;
  version: string;
  channel: MarketplaceChannel;
  reviewStatus: MarketplaceReviewStatus;
  supportedHosts: ExtensionHostKind[];
  supportsCurrentHost: boolean;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  sourceFileName: string;
  catalogItem: MarketplaceCatalogItem;
  detail: MarketplaceDetail;
}

export interface PrepareMarketplaceInstallRequest {
  extensionId: string;
  version?: string;
}

export interface InstallMarketplaceExtensionRequest {
  extensionId: string;
  version?: string;
  reviewAcknowledged?: boolean;
}

export interface HostExtensionMarketplaceManager {
  listCatalog(): Promise<readonly MarketplaceCatalogItem[]>;
  getDetail(extensionId: string): Promise<MarketplaceDetail>;
  getReadme(extensionId: string): Promise<string>;
  prepareInstall(request: PrepareMarketplaceInstallRequest): Promise<MarketplacePreparedInstall>;
  install(request: InstallMarketplaceExtensionRequest): Promise<HostInstalledExtension>;
}

export interface HostExtensionMarketplaceOptions {
  registryBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface MarketplaceCatalogDocument {
  schemaVersion: number;
  items: MarketplaceCatalogItem[];
}

interface MarketplaceDetailDocument {
  schemaVersion: number;
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  readmePath: string;
  versions: MarketplaceDetailVersion[];
}

export function createHostExtensionMarketplace(
  context: ExtensionManagementContext,
  options: HostExtensionMarketplaceOptions = {},
): HostExtensionMarketplaceManager {
  const registryBaseUrl = ensureTrailingSlash(
    options.registryBaseUrl?.trim() || DEFAULT_MARKETPLACE_REGISTRY_BASE_URL,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  let catalogPromise: Promise<MarketplaceCatalogDocument> | undefined;
  const detailPromiseCache = new Map<string, Promise<MarketplaceDetailDocument>>();
  const readmePromiseCache = new Map<string, Promise<string>>();

  return {
    async listCatalog() {
      const catalog = await loadCatalogDocument(fetchImpl, registryBaseUrl, catalogPromise);
      catalogPromise = Promise.resolve(catalog);
      return catalog.items;
    },
    async getDetail(extensionId) {
      const detail = await loadDetailDocument(
        extensionId,
        fetchImpl,
        registryBaseUrl,
        detailPromiseCache,
        () => loadCatalogDocument(fetchImpl, registryBaseUrl, catalogPromise),
      );
      catalogPromise ??= loadCatalogDocument(fetchImpl, registryBaseUrl, undefined);
      return detail;
    },
    async getReadme(extensionId) {
      const cacheKey = extensionId.trim();
      if (!cacheKey) {
        throw new Error('扩展 id 不能为空。');
      }
      const cached = readmePromiseCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      const nextPromise = (async () => {
        const detail = await loadDetailDocument(
          cacheKey,
          fetchImpl,
          registryBaseUrl,
          detailPromiseCache,
          () => loadCatalogDocument(fetchImpl, registryBaseUrl, catalogPromise),
        );
        const readmeUrl = resolveRegistryAssetUrl(detail.readmePath, registryBaseUrl);
        return fetchText(readmeUrl, fetchImpl, '扩展 README');
      })();
      readmePromiseCache.set(cacheKey, nextPromise);
      return nextPromise;
    },
    async prepareInstall(request) {
      const prepared = await prepareMarketplaceInstall(context.hostKind, request, fetchImpl, registryBaseUrl, detailPromiseCache, () => loadCatalogDocument(fetchImpl, registryBaseUrl, catalogPromise));
      catalogPromise ??= loadCatalogDocument(fetchImpl, registryBaseUrl, undefined);
      return prepared;
    },
    async install(request) {
      const prepared = await prepareMarketplaceInstall(context.hostKind, request, fetchImpl, registryBaseUrl, detailPromiseCache, () => loadCatalogDocument(fetchImpl, registryBaseUrl, catalogPromise));
      if (!prepared.supportsCurrentHost) {
        throw new Error(`此扩展版本不支持当前宿主安装：${prepared.extensionId}@${prepared.version}`);
      }
      if (prepared.reviewStatus !== 'verified' && request.reviewAcknowledged !== true) {
        throw new Error(`扩展 ${prepared.extensionId}@${prepared.version} 尚未验证，安装前必须显式确认。`);
      }
      if (!prepared.tarballUrl) {
        throw new Error(`扩展 ${prepared.extensionId}@${prepared.version} 缺少 tarballUrl，无法安装。`);
      }

      const tarballBuffer = await fetchBinary(prepared.tarballUrl, fetchImpl, '扩展 tarball');
      verifyDownloadedTarball(tarballBuffer, prepared);

      const tempDirectory = await mkdtemp(path.join(os.tmpdir(), MARKETPLACE_TEMP_DIR_PREFIX));
      const tarballFilePath = path.join(tempDirectory, prepared.sourceFileName);
      const extractedPackageDirectory = path.join(tempDirectory, 'package');

      try {
        await writeFile(tarballFilePath, tarballBuffer);
        await extractTar({
          file: tarballFilePath,
          cwd: tempDirectory,
          strict: true,
          preservePaths: false,
        });

        if (!existsSync(extractedPackageDirectory)) {
          throw new Error(`扩展 tarball 解包后缺少 package/ 根目录：${prepared.extensionId}@${prepared.version}`);
        }

        const installed = await installPreparedExtensionDirectory(context, {
          preparedDirectoryPath: extractedPackageDirectory,
          fileName: prepared.sourceFileName,
          replaceExisting: true,
        });
        return installed;
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    },
  };
}

async function prepareMarketplaceInstall(
  hostKind: ExtensionHostKind,
  request: PrepareMarketplaceInstallRequest,
  fetchImpl: typeof fetch,
  registryBaseUrl: string,
  detailPromiseCache: Map<string, Promise<MarketplaceDetailDocument>>,
  loadCatalog: () => Promise<MarketplaceCatalogDocument>,
): Promise<MarketplacePreparedInstall> {
  const extensionId = request.extensionId.trim();
  if (!extensionId) {
    throw new Error('扩展 id 不能为空。');
  }

  const catalog = await loadCatalog();
  const catalogItem = catalog.items.find((item) => item.extensionId === extensionId);
  if (!catalogItem) {
    throw new Error(`未在 marketplace catalog 中找到扩展：${extensionId}`);
  }

  const detail = await loadDetailDocument(
    extensionId,
    fetchImpl,
    registryBaseUrl,
    detailPromiseCache,
    () => Promise.resolve(catalog),
  );
  const requestedVersion = request.version?.trim();
  const resolvedVersion = requestedVersion || detail.defaultVersion;
  const version = detail.versions.find((entry) => entry.version === resolvedVersion);
  if (!version) {
    throw new Error(`扩展 ${extensionId} 不存在版本：${resolvedVersion}`);
  }

  return {
    extensionId: catalogItem.extensionId,
    packageName: catalogItem.packageName,
    displayName: version.displayName,
    description: version.description,
    version: version.version,
    channel: version.channel,
    reviewStatus: catalogItem.defaultReviewStatus,
    supportedHosts: [...version.supportedHosts],
    supportsCurrentHost: version.supportedHosts.includes(hostKind),
    ...(version.tarballUrl ? { tarballUrl: version.tarballUrl } : {}),
    ...(version.integrity ? { integrity: version.integrity } : {}),
    ...(version.shasum ? { shasum: version.shasum } : {}),
    sourceFileName: deriveDownloadFileName(version.tarballUrl, extensionId, version.version),
    catalogItem,
    detail,
  };
}

async function loadCatalogDocument(
  fetchImpl: typeof fetch,
  registryBaseUrl: string,
  cachedPromise?: Promise<MarketplaceCatalogDocument>,
): Promise<MarketplaceCatalogDocument> {
  if (cachedPromise) {
    return cachedPromise;
  }
  const raw = await fetchJson(resolveRegistryAssetUrl('catalog.json', registryBaseUrl), fetchImpl, 'marketplace catalog');
  return parseCatalogDocument(raw);
}

async function loadDetailDocument(
  extensionId: string,
  fetchImpl: typeof fetch,
  registryBaseUrl: string,
  detailPromiseCache: Map<string, Promise<MarketplaceDetailDocument>>,
  loadCatalog: () => Promise<MarketplaceCatalogDocument>,
): Promise<MarketplaceDetailDocument> {
  const normalizedId = extensionId.trim();
  if (!normalizedId) {
    throw new Error('扩展 id 不能为空。');
  }

  const cached = detailPromiseCache.get(normalizedId);
  if (cached) {
    return cached;
  }

  const nextPromise = (async () => {
    const catalog = await loadCatalog();
    const catalogItem = catalog.items.find((item) => item.extensionId === normalizedId);
    if (!catalogItem) {
      throw new Error(`未在 marketplace catalog 中找到扩展：${normalizedId}`);
    }

    const raw = await fetchJson(
      resolveRegistryAssetUrl(catalogItem.detailPath, registryBaseUrl),
      fetchImpl,
      'marketplace detail',
    );
    const detail = parseDetailDocument(raw);
    if (detail.extensionId !== normalizedId) {
      throw new Error(`marketplace detail 扩展 id 不匹配：期望 ${normalizedId}，实际 ${detail.extensionId}`);
    }
    return detail;
  })();

  detailPromiseCache.set(normalizedId, nextPromise);
  return nextPromise;
}

async function fetchJson(url: string, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const response = await fetchResponse(url, fetchImpl, label);
  if (!response.ok) {
    throw new Error(`${label} 拉取失败：${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} 不是合法 JSON：${url}`);
  }
}

async function fetchText(url: string, fetchImpl: typeof fetch, label: string): Promise<string> {
  const response = await fetchResponse(url, fetchImpl, label);
  if (!response.ok) {
    throw new Error(`${label} 拉取失败：${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchBinary(url: string, fetchImpl: typeof fetch, label: string): Promise<Buffer> {
  const response = await fetchResponse(url, fetchImpl, label);
  if (!response.ok) {
    throw new Error(`${label} 下载失败：${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchResponse(url: string, fetchImpl: typeof fetch, label: string): Promise<Response> {
  try {
    return await fetchImpl(url);
  } catch (error) {
    throw new Error(`${label} 请求失败：${url}；${extractErrorMessage(error)}`);
  }
}

function parseCatalogDocument(value: unknown): MarketplaceCatalogDocument {
  const root = requiredRecord(value, 'marketplace catalog');
  const schemaVersion = numberField(root.schemaVersion, 'catalog.schemaVersion');
  if (schemaVersion !== 1) {
    throw new Error(`仅支持 marketplace catalog schemaVersion=1，收到 ${schemaVersion}`);
  }
  const items = arrayField(root.items, 'catalog.items').map((entry, index) =>
    parseCatalogItem(entry, `catalog.items[${index}]`),
  );
  return { schemaVersion, items };
}

function parseCatalogItem(value: unknown, fieldPrefix: string): MarketplaceCatalogItem {
  const item = requiredRecord(value, fieldPrefix);
  return {
    extensionId: nonEmptyString(item.extensionId, `${fieldPrefix}.extensionId`),
    packageName: nonEmptyString(item.packageName, `${fieldPrefix}.packageName`),
    status: nonEmptyString(item.status, `${fieldPrefix}.status`),
    featured: booleanField(item.featured, `${fieldPrefix}.featured`),
    defaultVersion: nonEmptyString(item.defaultVersion, `${fieldPrefix}.defaultVersion`),
    defaultChannel: enumField(item.defaultChannel, `${fieldPrefix}.defaultChannel`, ['stable', 'preview', 'experimental']),
    defaultReviewStatus: enumField(item.defaultReviewStatus, `${fieldPrefix}.defaultReviewStatus`, ['unverified', 'verified', 'revoked']),
    detailPath: nonEmptyString(item.detailPath, `${fieldPrefix}.detailPath`),
    displayName: nonEmptyString(item.displayName, `${fieldPrefix}.displayName`),
    description: nonEmptyString(item.description, `${fieldPrefix}.description`),
    ...(optionalNonEmptyString(item.author) ? { author: optionalNonEmptyString(item.author)! } : {}),
    ...(optionalNonEmptyString(item.homepageUrl) ? { homepageUrl: optionalNonEmptyString(item.homepageUrl)! } : {}),
    ...(optionalNonEmptyString(item.repositoryUrl) ? { repositoryUrl: optionalNonEmptyString(item.repositoryUrl)! } : {}),
    keywords: optionalStringArray(item.keywords, `${fieldPrefix}.keywords`),
    supportedHosts: requiredHostKinds(item.supportedHosts, `${fieldPrefix}.supportedHosts`),
    requestedCapabilities: optionalStringArray(item.requestedCapabilities, `${fieldPrefix}.requestedCapabilities`),
    ...(optionalNonEmptyString(item.iconUrl) ? { iconUrl: optionalNonEmptyString(item.iconUrl)! } : {}),
  };
}

function parseDetailDocument(value: unknown): MarketplaceDetailDocument {
  const root = requiredRecord(value, 'marketplace detail');
  const schemaVersion = numberField(root.schemaVersion, 'detail.schemaVersion');
  if (schemaVersion !== 1) {
    throw new Error(`仅支持 marketplace detail schemaVersion=1，收到 ${schemaVersion}`);
  }
  const versions = arrayField(root.versions, 'detail.versions').map((entry, index) =>
    parseDetailVersion(entry, `detail.versions[${index}]`),
  );
  if (versions.length === 0) {
    throw new Error('marketplace detail.versions 不能为空。');
  }
  return {
    schemaVersion,
    extensionId: nonEmptyString(root.extensionId, 'detail.extensionId'),
    packageName: nonEmptyString(root.packageName, 'detail.packageName'),
    status: nonEmptyString(root.status, 'detail.status'),
    featured: booleanField(root.featured, 'detail.featured'),
    defaultVersion: nonEmptyString(root.defaultVersion, 'detail.defaultVersion'),
    readmePath: nonEmptyString(root.readmePath, 'detail.readmePath'),
    versions,
  };
}

function parseDetailVersion(value: unknown, fieldPrefix: string): MarketplaceDetailVersion {
  const version = requiredRecord(value, fieldPrefix);
  const changelogValue = version.changelog;
  const parsedChangelog = isRecord(changelogValue)
    ? {
        summary: nonEmptyString(changelogValue.summary, `${fieldPrefix}.changelog.summary`),
        body: nonEmptyString(changelogValue.body, `${fieldPrefix}.changelog.body`),
      }
    : undefined;

  return {
    version: nonEmptyString(version.version, `${fieldPrefix}.version`),
    channel: enumField(version.channel, `${fieldPrefix}.channel`, ['stable', 'preview', 'experimental']),
    reviewStatus: enumField(version.reviewStatus, `${fieldPrefix}.reviewStatus`, ['unverified', 'verified', 'revoked']),
    displayName: nonEmptyString(version.displayName, `${fieldPrefix}.displayName`),
    description: nonEmptyString(version.description, `${fieldPrefix}.description`),
    ...(optionalNonEmptyString(version.author) ? { author: optionalNonEmptyString(version.author)! } : {}),
    ...(optionalNonEmptyString(version.homepageUrl) ? { homepageUrl: optionalNonEmptyString(version.homepageUrl)! } : {}),
    ...(optionalNonEmptyString(version.repositoryUrl) ? { repositoryUrl: optionalNonEmptyString(version.repositoryUrl)! } : {}),
    keywords: optionalStringArray(version.keywords, `${fieldPrefix}.keywords`),
    supportedHosts: requiredHostKinds(version.supportedHosts, `${fieldPrefix}.supportedHosts`),
    requestedCapabilities: optionalStringArray(version.requestedCapabilities, `${fieldPrefix}.requestedCapabilities`),
    ...(optionalNonEmptyString(version.iconUrl) ? { iconUrl: optionalNonEmptyString(version.iconUrl)! } : {}),
    ...(optionalNonEmptyString(version.publishedAt) ? { publishedAt: optionalNonEmptyString(version.publishedAt)! } : {}),
    ...(optionalNonEmptyString(version.tarballUrl) ? { tarballUrl: optionalNonEmptyString(version.tarballUrl)! } : {}),
    ...(optionalNonEmptyString(version.integrity) ? { integrity: optionalNonEmptyString(version.integrity)! } : {}),
    ...(optionalNonEmptyString(version.shasum) ? { shasum: optionalNonEmptyString(version.shasum)! } : {}),
    ...(parsedChangelog ? { changelog: parsedChangelog } : {}),
  };
}

function verifyDownloadedTarball(
  buffer: Buffer,
  prepared: Pick<MarketplacePreparedInstall, 'extensionId' | 'version' | 'integrity' | 'shasum'>,
): void {
  if (prepared.integrity) {
    const integrityEntries = prepared.integrity.split(/\s+/u).filter(Boolean);
    const matched = integrityEntries.some((entry) => verifySriEntry(buffer, entry));
    if (!matched) {
      throw new Error(`扩展 tarball integrity 校验失败：${prepared.extensionId}@${prepared.version}`);
    }
  }

  if (prepared.shasum) {
    const actual = createHash('sha1').update(buffer).digest('hex');
    if (actual.toLowerCase() !== prepared.shasum.toLowerCase()) {
      throw new Error(`扩展 tarball shasum 校验失败：${prepared.extensionId}@${prepared.version}`);
    }
  }
}

function verifySriEntry(buffer: Buffer, entry: string): boolean {
  const separatorIndex = entry.indexOf('-');
  if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
    return false;
  }
  const algorithm = entry.slice(0, separatorIndex);
  const expected = entry.slice(separatorIndex + 1);
  try {
    const actual = createHash(algorithm).update(buffer).digest('base64');
    return actual === expected;
  } catch {
    return false;
  }
}

function deriveDownloadFileName(
  tarballUrl: string | undefined,
  extensionId: string,
  version: string,
): string {
  if (tarballUrl) {
    try {
      const baseName = path.posix.basename(new URL(tarballUrl).pathname);
      const trimmed = decodeURIComponent(baseName).trim();
      if (trimmed) {
        return trimmed;
      }
    } catch {
      // ignore and fall back
    }
  }
  return `${extensionId.replace(/[^a-z0-9._-]+/giu, '-')}-${version}.tgz`;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolveRegistryAssetUrl(relativeOrAbsolutePath: string, registryBaseUrl: string): string {
  if (/^https?:\/\//iu.test(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }
  return new URL(relativeOrAbsolutePath.replace(/^\.\//u, ''), registryBaseUrl).href;
}

function requiredRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} 必须是对象。`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function nonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return value.trim();
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanField(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} 必须是布尔值。`);
  }
  return value;
}

function numberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} 必须是数字。`);
  }
  return value;
}

function arrayField(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} 必须是数组。`);
  }
  return value;
}

function enumField<const T extends string>(
  value: unknown,
  fieldName: string,
  allowed: readonly T[],
): T {
  const normalized = nonEmptyString(value, fieldName) as T;
  if (!allowed.includes(normalized)) {
    throw new Error(`${fieldName} 取值非法：${normalized}`);
  }
  return normalized;
}

function optionalStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  return arrayField(value, fieldName).map((entry, index) =>
    nonEmptyString(entry, `${fieldName}[${index}]`),
  );
}

function requiredHostKinds(value: unknown, fieldName: string): ExtensionHostKind[] {
  const result = optionalStringArray(value, fieldName).map((entry) => {
    if (entry !== 'cli' && entry !== 'desktop') {
      throw new Error(`${fieldName} 取值非法：${entry}`);
    }
    return entry;
  });
  if (result.length === 0) {
    throw new Error(`${fieldName} 至少需要一个宿主。`);
  }
  return result;
}
