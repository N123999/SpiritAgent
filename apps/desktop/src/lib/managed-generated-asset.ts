export const MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX = "spirit://generated/";

export type ManagedGeneratedAssetKind = "image" | "video";

export function isManagedGeneratedAssetRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX);
}

export function isManagedGeneratedImageRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(`${MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX}image/`);
}

export function isManagedGeneratedVideoRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(`${MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX}video/`);
}

export function parseManagedGeneratedAssetKind(value: string): ManagedGeneratedAssetKind | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith(`${MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX}image/`)) {
    return "image";
  }
  if (normalized.startsWith(`${MANAGED_GENERATED_ASSET_PROTOCOL_PREFIX}video/`)) {
    return "video";
  }
  return null;
}
