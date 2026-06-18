import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

const SCHEME = 'spirit';
const GENERATED_HOST = 'generated';

export function registerSpiritGeneratedAssetPrivilegedScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);
}

export type ResolveManagedGeneratedAssetPath = (reference: string) => Promise<string | null>;
export type VideoPreviewMimeType = (extension: string) => string | null | undefined;
export type ImagePreviewMimeType = (extension: string) => string | null | undefined;

export function installSpiritGeneratedAssetProtocolHandler(deps: {
  resolveManagedGeneratedAssetPath: ResolveManagedGeneratedAssetPath;
  videoPreviewMimeType: VideoPreviewMimeType;
  imagePreviewMimeType: ImagePreviewMimeType;
}): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== GENERATED_HOST) {
      return new Response('Not Found', { status: 404 });
    }

    const filePath = await deps.resolveManagedGeneratedAssetPath(request.url);
    if (!filePath) {
      return new Response('Not Found', { status: 404 });
    }

    const extension = path.extname(filePath).toLowerCase();
    const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    const kind = segments[0]?.toLowerCase();
    const mimeType =
      kind === 'video'
        ? deps.videoPreviewMimeType(extension)
        : kind === 'image'
          ? deps.imagePreviewMimeType(extension)
          : null;
    if (!mimeType) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    try {
      const fileResponse = await net.fetch(pathToFileURL(filePath).href, {
        method: request.method,
        headers: request.headers,
      });

      const headers = new Headers(fileResponse.headers);
      headers.set('Content-Type', mimeType);
      headers.set('Accept-Ranges', 'bytes');

      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });
}
