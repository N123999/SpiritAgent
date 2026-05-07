import path from 'node:path';

type SupportedImageExtension = '.bmp' | '.gif' | '.jpeg' | '.jpg' | '.png' | '.webp';

export interface SupportedImageFile {
  extension: SupportedImageExtension;
  mimeType: string;
}

const SUPPORTED_IMAGE_MIME_TYPES: Record<SupportedImageExtension, string> = {
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function hasSupportedImageExtension(filePath: string): boolean {
  return supportedImageExtension(filePath) !== undefined;
}

export function detectSupportedImageFile(
  filePath: string,
  bytes: Uint8Array,
): SupportedImageFile | undefined {
  const extension = supportedImageExtension(filePath);
  if (!extension) {
    return undefined;
  }

  if (!matchesImageSignature(extension, bytes)) {
    return undefined;
  }

  return {
    extension,
    mimeType: SUPPORTED_IMAGE_MIME_TYPES[extension],
  };
}

function supportedImageExtension(filePath: string): SupportedImageExtension | undefined {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.bmp':
    case '.gif':
    case '.jpeg':
    case '.jpg':
    case '.png':
    case '.webp':
      return extension;
    default:
      return undefined;
  }
}

function matchesImageSignature(extension: SupportedImageExtension, bytes: Uint8Array): boolean {
  switch (extension) {
    case '.bmp':
      return hasAsciiPrefix(bytes, 'BM');
    case '.png':
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case '.jpg':
    case '.jpeg':
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case '.gif':
      return hasAsciiPrefix(bytes, 'GIF87a') || hasAsciiPrefix(bytes, 'GIF89a');
    case '.webp':
      return hasAsciiPrefix(bytes, 'RIFF') && hasAsciiPrefix(bytes.slice(8), 'WEBP');
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  return prefix.every((value, index) => bytes[index] === value);
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  const expected = Array.from(prefix, (char) => char.charCodeAt(0));
  return hasPrefix(bytes, expected);
}