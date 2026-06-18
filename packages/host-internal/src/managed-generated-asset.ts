import path from 'node:path';

export const MANAGED_GENERATED_ASSET_PROTOCOL = 'spirit:';
export const MANAGED_GENERATED_ASSET_HOST = 'generated';

export const GENERATED_IMAGES_DIR = 'generated-images';
export const GENERATED_VIDEOS_DIR = 'generated-videos';

export type ManagedGeneratedAssetKind = 'image' | 'video';

export interface ParsedManagedGeneratedAssetReference {
  kind: ManagedGeneratedAssetKind;
  basename: string;
  reference: string;
}

export function generatedDirForKind(kind: ManagedGeneratedAssetKind): string {
  return kind === 'image' ? GENERATED_IMAGES_DIR : GENERATED_VIDEOS_DIR;
}

export function buildManagedGeneratedAssetRef(
  kind: ManagedGeneratedAssetKind,
  basename: string,
): string {
  return `${MANAGED_GENERATED_ASSET_PROTOCOL}//${MANAGED_GENERATED_ASSET_HOST}/${kind}/${encodeURIComponent(basename)}`;
}

export function generatedImageMarkdownRef(filePath: string): string {
  return buildManagedGeneratedAssetRef('image', path.basename(filePath));
}

export function generatedVideoMarkdownRef(filePath: string): string {
  return buildManagedGeneratedAssetRef('video', path.basename(filePath));
}

export function parseManagedGeneratedAssetReference(
  reference: string,
): ParsedManagedGeneratedAssetReference | undefined {
  const trimmed = reference.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (url.protocol.toLowerCase() !== MANAGED_GENERATED_ASSET_PROTOCOL) {
    return undefined;
  }

  if (
    url.hostname.toLowerCase() !== MANAGED_GENERATED_ASSET_HOST ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(`无效的 Spirit 托管资源引用: ${trimmed}`);
  }

  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`无效的 Spirit 托管资源引用: ${trimmed}`);
  }

  const kindSegment = segments[0]?.toLowerCase();
  if (kindSegment !== 'image' && kindSegment !== 'video') {
    throw new Error(`无效的 Spirit 托管资源引用: ${trimmed}`);
  }

  let basename: string;
  try {
    basename = decodeURIComponent(segments[1] ?? '').trim();
  } catch {
    throw new Error(`无效的 Spirit 托管资源引用: ${trimmed}`);
  }

  if (
    !basename ||
    basename !== path.basename(basename) ||
    basename === '.' ||
    basename === '..' ||
    basename.includes('/') ||
    basename.includes('\\')
  ) {
    throw new Error(`无效的 Spirit 托管资源引用: ${trimmed}`);
  }

  return {
    kind: kindSegment,
    basename,
    reference: trimmed,
  };
}

export function normalizeManagedGeneratedAssetRef(
  markdownRef: string,
  expectedKind: ManagedGeneratedAssetKind,
): string {
  const parsed = parseManagedGeneratedAssetReference(markdownRef);
  if (!parsed) {
    throw new Error('Host returned an invalid generated asset markdownRef.');
  }
  if (parsed.kind !== expectedKind) {
    throw new Error(`Host returned a generated asset markdownRef with unexpected kind: ${parsed.kind}`);
  }
  return buildManagedGeneratedAssetRef(parsed.kind, parsed.basename);
}
