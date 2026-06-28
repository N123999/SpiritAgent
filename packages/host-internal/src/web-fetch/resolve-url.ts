const SKIP_LINK_SCHEMES = new Set(['javascript:', 'mailto:', 'tel:', 'data:']);

export function normalizeMimeType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function resolveAbsoluteUrl(href: string, baseUrl: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  for (const scheme of SKIP_LINK_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return undefined;
    }
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function looksLikeHtml(raw: string): boolean {
  const prefix = raw.slice(0, 512).toLowerCase();
  return (
    prefix.includes('<html') ||
    prefix.includes('<!doctype html') ||
    prefix.includes('<body') ||
    prefix.includes('<head')
  );
}
