/** Windows drive letter (`C:\`) or UNC (`\\server\share`). */
const WINDOWS_ABSOLUTE_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/u;

/** Unix absolute path (`/home/...`). */
const UNIX_ABSOLUTE_PATTERN = /^\//u;

export function looksLikeAbsolutePath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  return WINDOWS_ABSOLUTE_PATTERN.test(trimmed) || UNIX_ABSOLUTE_PATTERN.test(trimmed);
}

export function normalizeAbsolutePathInput(input: string): string {
  return input.trim();
}

export function workspaceFileBasename(relativePath: string): string {
  const normalized = relativePath.replace(/\/+$/u, '');
  const segments = normalized.split('/');
  return segments[segments.length - 1] || normalized;
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx|markdown|mdown|mkd|mkdn|mdwn)$/i.test(path);
}

/** 与 @ 引用菜单一致：至多一个 `@` 前缀。 */
export function toWorkspaceFileReferenceQueryInput(trimmed: string): string {
  const normalized = trimmed.trim();
  if (!normalized) {
    return '@';
  }
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}
