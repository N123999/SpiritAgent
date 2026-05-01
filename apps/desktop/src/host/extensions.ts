import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildContributedHostToolDefinitions,
  type JsonObject,
  type JsonValue,
  type OpenAiExtensionSystemPrompt,
} from '@spirit-agent/agent-core';
import {
  collectHostExtensionContributedTools,
  type HostExtensionManager,
  type HostInstalledExtension,
} from '@spirit-agent/host-internal';

import type {
  DesktopExtensionCssLayer,
  DesktopExtensionListItem,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
} from '../types.js';

export function buildDesktopExtensionToolDefinitions(
  extensions: readonly HostInstalledExtension[],
): JsonValue[] {
  return buildContributedHostToolDefinitions(
    collectHostExtensionContributedTools(extensions).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as JsonObject,
    })),
  );
}

export async function buildDesktopExtensionListItems(
  manager: HostExtensionManager,
  extensions: readonly HostInstalledExtension[],
): Promise<DesktopExtensionListItem[]> {
  return Promise.all(extensions.map(async (item) => ({
    id: item.id,
    displayName: item.manifest.name,
    ...(item.manifest.icon ? { icon: item.manifest.icon } : {}),
    version: item.manifest.version,
    ...(item.manifest.description ? { description: item.manifest.description } : {}),
    ...(item.manifest.author ? { author: item.manifest.author } : {}),
    ...(item.manifest.homepage ? { homepage: item.manifest.homepage } : {}),
    ...(item.manifest.main ? { main: item.manifest.main } : {}),
    supportedHosts: [...item.manifest.supportedHosts],
    ...(item.manifest.activationEvents?.length
      ? { activationEvents: [...item.manifest.activationEvents] }
      : {}),
    ...(item.manifest.requestedCapabilities?.length
      ? { requestedCapabilities: [...item.manifest.requestedCapabilities] }
      : {}),
    ...(item.manifest.contributes?.tools?.length
      ? {
          contributedTools: item.manifest.contributes.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            ...(tool.approvalMode ? { approvalMode: tool.approvalMode } : {}),
            ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
          })),
        }
      : {}),
    ...(item.manifest.contributes?.desktop?.css?.length
      ? {
          desktopCss: item.manifest.contributes.desktop.css.map((entry) => ({
            path: entry.path,
            ...(entry.media ? { media: entry.media } : {}),
          })),
        }
      : {}),
    ...(item.manifest.contributes?.cli?.hooks?.length
      ? {
          cliHooks: item.manifest.contributes.cli.hooks.map((hook) => ({
            slot: hook.slot,
            ...(hook.variant ? { variant: hook.variant } : {}),
            ...(hook.tokens
              ? {
                  tokens: {
                    ...(hook.tokens.foreground ? { foreground: hook.tokens.foreground } : {}),
                    ...(hook.tokens.border ? { border: hook.tokens.border } : {}),
                    ...(hook.tokens.accent ? { accent: hook.tokens.accent } : {}),
                  },
                }
              : {}),
            ...(hook.prefix ? { prefix: hook.prefix } : {}),
            ...(hook.suffix ? { suffix: hook.suffix } : {}),
          })),
        }
      : {}),
    ...(item.manifest.settingsSchema?.length
      ? {
          settingsSchema: item.manifest.settingsSchema.map((setting) => ({
            key: setting.key,
            type: setting.type,
            title: setting.title,
            ...(setting.description ? { description: setting.description } : {}),
            ...(setting.placeholder ? { placeholder: setting.placeholder } : {}),
            ...(setting.required !== undefined ? { required: setting.required } : {}),
            ...(setting.defaultValue !== undefined
              ? { defaultValue: setting.defaultValue }
              : {}),
            ...(setting.options?.length
              ? {
                  options: setting.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                    ...(option.description ? { description: option.description } : {}),
                  })),
                }
              : {}),
          })),
          settingsValues: await manager.getSettingsValues(item.id),
        }
      : {}),
    ...(item.manifest.secretSlots?.length
      ? {
          secretSlots: item.manifest.secretSlots.map((slot) => ({
            key: slot.key,
            title: slot.title,
            ...(slot.description ? { description: slot.description } : {}),
            ...(slot.required !== undefined ? { required: slot.required } : {}),
          })),
          secretStatuses: Object.entries(
            await manager.getSecretStatus(item.id),
          ).map(([key, configured]) => ({
            key,
            configured,
          })),
        }
      : {}),
    ...(item.archiveFileName ? { archiveFileName: item.archiveFileName } : {}),
    installedAtUnixMs: item.installedAtUnixMs,
  })));
}

export async function collectDesktopExtensionCssLayers(
  extensions: readonly HostInstalledExtension[],
): Promise<DesktopExtensionCssLayer[]> {
  const layers: DesktopExtensionCssLayer[] = [];

  for (const item of extensions) {
    const cssEntries = item.manifest.contributes?.desktop?.css ?? [];
    for (const entry of cssEntries) {
      const sourcePath = path.join(item.directoryPath, ...entry.path.split('/'));
      try {
        const cssText = await readFile(sourcePath, 'utf8');
        if (!cssText.trim()) {
          continue;
        }
        layers.push({
          extensionId: item.id,
          extensionName: item.manifest.name,
          sourcePath: entry.path,
          cssText,
          ...(entry.media ? { media: entry.media } : {}),
        });
      } catch (error) {
        console.warn(
          `[desktop-host][extensions] read css failed: ${item.id}:${entry.path}`,
          error,
        );
      }
    }
  }

  return layers;
}

export async function collectExtensionSystemPrompts(
  manager: HostExtensionManager,
  host: unknown,
): Promise<OpenAiExtensionSystemPrompt[]> {
  const collected = await manager.collectSystemPromptContributions({
    host,
    logger: console,
  });
  return collected.map((entry) => ({
    extensionId: entry.extensionId,
    extensionName: entry.extensionName,
    content: entry.content,
  }));
}

export function toDesktopMarketplaceCatalogItem(item: {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  defaultChannel: 'stable' | 'preview' | 'experimental';
  defaultReviewStatus: 'unverified' | 'verified' | 'revoked';
  detailPath: string;
  displayName: string;
  description: string;
  author?: string;
  homepageUrl?: string;
  repositoryUrl?: string;
  keywords: string[];
  supportedHosts: Array<'cli' | 'desktop'>;
  requestedCapabilities: string[];
  iconUrl?: string;
}): DesktopMarketplaceCatalogItem {
  return {
    extensionId: item.extensionId,
    packageName: item.packageName,
    status: item.status,
    featured: item.featured,
    defaultVersion: item.defaultVersion,
    defaultChannel: item.defaultChannel,
    defaultReviewStatus: item.defaultReviewStatus,
    detailPath: item.detailPath,
    displayName: item.displayName,
    description: item.description,
    ...(item.author ? { author: item.author } : {}),
    ...(item.homepageUrl ? { homepageUrl: item.homepageUrl } : {}),
    ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
    keywords: [...item.keywords],
    supportedHosts: [...item.supportedHosts],
    requestedCapabilities: [...item.requestedCapabilities],
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
  };
}

export function toDesktopMarketplaceDetail(detail: {
  extensionId: string;
  packageName: string;
  status: string;
  featured: boolean;
  defaultVersion: string;
  readmePath: string;
  versions: Array<{
    version: string;
    channel: 'stable' | 'preview' | 'experimental';
    reviewStatus: 'unverified' | 'verified' | 'revoked';
    displayName: string;
    description: string;
    author?: string;
    homepageUrl?: string;
    repositoryUrl?: string;
    keywords: string[];
    supportedHosts: Array<'cli' | 'desktop'>;
    requestedCapabilities: string[];
    iconUrl?: string;
    publishedAt?: string;
    tarballUrl?: string;
    integrity?: string;
    shasum?: string;
    changelog?: {
      summary: string;
      body: string;
    };
  }>;
}): DesktopMarketplaceDetail {
  return {
    extensionId: detail.extensionId,
    packageName: detail.packageName,
    status: detail.status,
    featured: detail.featured,
    defaultVersion: detail.defaultVersion,
    readmePath: detail.readmePath,
    versions: detail.versions.map((item) => ({
      version: item.version,
      channel: item.channel,
      reviewStatus: item.reviewStatus,
      displayName: item.displayName,
      description: item.description,
      ...(item.author ? { author: item.author } : {}),
      ...(item.homepageUrl ? { homepageUrl: item.homepageUrl } : {}),
      ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
      keywords: [...item.keywords],
      supportedHosts: [...item.supportedHosts],
      requestedCapabilities: [...item.requestedCapabilities],
      ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.tarballUrl ? { tarballUrl: item.tarballUrl } : {}),
      ...(item.integrity ? { integrity: item.integrity } : {}),
      ...(item.shasum ? { shasum: item.shasum } : {}),
      ...(item.changelog
        ? {
            changelog: {
              summary: item.changelog.summary,
              body: item.changelog.body,
            },
          }
        : {}),
    })),
  };
}

export function toDesktopMarketplacePreparedInstall(prepared: {
  extensionId: string;
  packageName: string;
  displayName: string;
  description: string;
  version: string;
  channel: 'stable' | 'preview' | 'experimental';
  reviewStatus: 'unverified' | 'verified' | 'revoked';
  supportedHosts: Array<'cli' | 'desktop'>;
  supportsCurrentHost: boolean;
  tarballUrl?: string;
  integrity?: string;
  shasum?: string;
  sourceFileName: string;
}): DesktopMarketplacePreparedInstall {
  return {
    extensionId: prepared.extensionId,
    packageName: prepared.packageName,
    displayName: prepared.displayName,
    description: prepared.description,
    version: prepared.version,
    channel: prepared.channel,
    reviewStatus: prepared.reviewStatus,
    supportedHosts: [...prepared.supportedHosts],
    supportsCurrentHost: prepared.supportsCurrentHost,
    ...(prepared.tarballUrl ? { tarballUrl: prepared.tarballUrl } : {}),
    ...(prepared.integrity ? { integrity: prepared.integrity } : {}),
    ...(prepared.shasum ? { shasum: prepared.shasum } : {}),
    sourceFileName: prepared.sourceFileName,
  };
}
