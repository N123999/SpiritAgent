const DEFAULT_WINDOWS_PATHEXT = ['.com', '.exe', '.cmd', '.bat'];

export function isWindowsPlatform(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

export function splitWindowsPathEntries(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function splitWindowsPathExtEntries(value: string | undefined): string[] {
  const source = value ?? DEFAULT_WINDOWS_PATHEXT.join(';');
  const entries = source
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return dedupePreservingOrder(entries);
}

export function buildWindowsCommandCandidates(
  command: string,
  pathEntries: string[],
  pathExtEntries: string[],
): string[] {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return [];
  }

  const hasDirectorySeparator = trimmedCommand.includes('\\') || trimmedCommand.includes('/');
  const hasExtension = /\.[^\\/\.]+$/.test(trimmedCommand);
  const basePaths = hasDirectorySeparator
    ? [trimmedCommand]
    : pathEntries.map((entry) => `${entry.replace(/[\\/]+$/, '')}\\${trimmedCommand}`);
  const extensions = hasExtension
    ? ['']
    : pathExtEntries.length > 0
      ? pathExtEntries
      : DEFAULT_WINDOWS_PATHEXT;

  const candidates: string[] = [];
  for (const basePath of basePaths) {
    for (const extension of extensions) {
      candidates.push(extension ? `${basePath}${extension}` : basePath);
    }
  }

  return dedupePreservingOrder(candidates);
}

function dedupePreservingOrder(entries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const entry of entries) {
    if (seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    unique.push(entry);
  }

  return unique;
}