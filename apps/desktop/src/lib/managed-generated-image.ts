export const MANAGED_GENERATED_IMAGE_PREFIX = "spirit-image://generated/";

export function isManagedGeneratedImageRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(MANAGED_GENERATED_IMAGE_PREFIX);
}
