import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as schema from '@agentclientprotocol/sdk';

/**
 * Extracts image content blocks from an ACP prompt and resolves them to file paths.
 *
 * ACP ImageContent can carry images in two ways:
 * - `uri`: a file:// or http(s):// URI — file URIs are passed directly
 * - `data`: base64-encoded image bytes — written to a temp file, path returned
 *
 * Returns an array of local file paths suitable for `explicitImages`.
 */
export async function extractPromptImages(
  prompt: schema.ContentBlock[],
): Promise<string[]> {
  const images: string[] = [];
  let tempDir: string | undefined;

  for (const block of prompt) {
    if (block.type !== 'image') {
      continue;
    }

    const image = block as schema.ImageContent;

    // Prefer URI if it's a local file path
    if (image.uri) {
      const uri = image.uri;
      if (uri.startsWith('file://')) {
        try {
          // Use fileURLToPath for cross-platform path conversion
          // (handles Windows /C:/... → C:\... etc.)
          const filePath = fileURLToPath(uri);
          images.push(filePath);
          continue;
        } catch {
          // Fall through to data handling
        }
      }
      // Non-file URIs (http, https) are not supported as explicitImages
      // The agent can fetch them via web_fetch if needed
      continue;
    }

    // Base64 data — write to temp file
    if (image.data) {
      if (!tempDir) {
        tempDir = await mkdtemp(path.join(tmpdir(), 'acp-images-'));
      }
      const ext = mimeTypeToExt(image.mimeType);
      const filePath = path.join(tempDir, `image-${images.length}${ext}`);
      await writeFile(filePath, Buffer.from(image.data, 'base64'));
      images.push(filePath);
    }
  }

  return images;
}

function mimeTypeToExt(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/gif': return '.gif';
    case 'image/webp': return '.webp';
    case 'image/svg+xml': return '.svg';
    default: return '.bin';
  }
}
