import { isMarkdownPath, looksLikeAbsolutePath } from '@/lib/file-picker-path';
import { parseReadFilePathFromToolSnapshot } from '@/lib/read-file-skill-display';
import { normalizeWorkspaceEntryRel } from '@/lib/workspace-entry-path-sync';
import type { EditorFileTarget } from '@/lib/workspace-editor-navigation';
import type { ToolBlockSnapshot } from '@/types';

function normalizePathForCompare(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/u, '');
}

function isWindowsStylePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(path.trim());
}

function pathsEqual(left: string, right: string): boolean {
  const a = normalizePathForCompare(left);
  const b = normalizePathForCompare(right);
  if (isWindowsStylePath(left) || isWindowsStylePath(right)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

function pathStartsWith(prefix: string, candidate: string): boolean {
  const normalizedPrefix = normalizePathForCompare(prefix);
  const normalizedCandidate = normalizePathForCompare(candidate);
  const caseInsensitive = isWindowsStylePath(prefix) || isWindowsStylePath(candidate);
  const lowerPrefix = caseInsensitive ? normalizedPrefix.toLowerCase() : normalizedPrefix;
  const lowerCandidate = caseInsensitive ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  if (lowerCandidate === lowerPrefix) {
    return true;
  }
  return lowerCandidate.startsWith(`${lowerPrefix}/`);
}

/** Map an absolute path under workspaceRoot to a workspace-relative path. */
export function tryResolveWorkspaceRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string | null {
  const root = workspaceRoot.trim();
  const absolute = absolutePath.trim();
  if (!root || !absolute) {
    return null;
  }
  if (!pathStartsWith(root, absolute)) {
    return null;
  }
  const rootNormalized = normalizePathForCompare(root);
  const absoluteNormalized = normalizePathForCompare(absolute);
  if (pathsEqual(rootNormalized, absoluteNormalized)) {
    return '.';
  }
  const suffix = absoluteNormalized.slice(rootNormalized.length).replace(/^\//u, '');
  return normalizeWorkspaceEntryRel(suffix) || '.';
}

function viewModeForPath(path: string): EditorFileTarget['viewMode'] {
  return isMarkdownPath(path) ? 'preview' : 'edit';
}

export function resolveReadFileEditorTarget(
  rawPath: string,
  workspaceRoot: string,
): EditorFileTarget | null {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return null;
  }

  if (!looksLikeAbsolutePath(trimmed)) {
    const relativePath = normalizeWorkspaceEntryRel(trimmed);
    return {
      scope: 'workspace',
      relativePath,
      viewMode: viewModeForPath(relativePath),
    };
  }

  const relativePath = tryResolveWorkspaceRelativePath(workspaceRoot, trimmed);
  if (relativePath) {
    return {
      scope: 'workspace',
      relativePath,
      viewMode: viewModeForPath(relativePath),
    };
  }

  return {
    scope: 'external',
    absolutePath: trimmed,
    viewMode: viewModeForPath(trimmed),
  };
}

export function resolveReadFileTargetFromTool(
  tool: Pick<ToolBlockSnapshot, 'argsExcerpt' | 'headline' | 'detailLines'>,
  workspaceRoot: string,
): EditorFileTarget | null {
  const rawPath = parseReadFilePathFromToolSnapshot(tool);
  if (!rawPath.trim()) {
    return null;
  }
  return resolveReadFileEditorTarget(rawPath, workspaceRoot);
}
