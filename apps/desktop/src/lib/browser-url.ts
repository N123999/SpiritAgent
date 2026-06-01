export function toLocalHostUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const port = Number.parseInt(trimmed, 10);
    if (port >= 1 && port <= 65_535) {
      return toLocalHostUrl(port);
    }
    return null;
  }

  if (trimmed.startsWith(":")) {
    const port = Number.parseInt(trimmed.slice(1), 10);
    if (port >= 1 && port <= 65_535) {
      return toLocalHostUrl(port);
    }
    return null;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
