import { isAbsolute, resolve } from 'node:path';

export function resolveLocalMediaPath(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (isAbsolute(normalized)) {
    return normalized;
  }

  return resolve(assetRoot, normalized);
}

export function pathToLocalVideoReference(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith('http://')
    || normalized.startsWith('https://')
    || normalized.startsWith('data:')
    || normalized.startsWith('ms://')
  ) {
    return normalized;
  }

  return resolveLocalMediaPath(normalized, assetRoot).replace(/\\/g, '/');
}
