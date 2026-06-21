export type SessionWorkLocation = 'local' | 'worktree';

const SPIRIT_WORKTREE_PATH_PATTERN = /^(.+)\.worktrees\/[^/]+$/u;

function normalizeWorkspacePathForMatch(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim();
  return trimmed.replace(/\\/g, '/').replace(/\/+$/g, '');
}

/** Browser-safe mirror of host-internal resolveWorkspaceGroupingRoot (avoid barrel import in renderer). */
export function resolveWorkspaceGroupingRoot(workspaceRoot: string): string {
  const trimmed = workspaceRoot.trim();
  const asPosix = normalizeWorkspacePathForMatch(trimmed);
  const match = asPosix.match(SPIRIT_WORKTREE_PATH_PATTERN);
  if (match?.[1]) {
    return match[1];
  }
  return asPosix || trimmed;
}

export function isSpiritWorktreeWorkspaceRoot(workspaceRoot: string): boolean {
  const asPosix = normalizeWorkspacePathForMatch(workspaceRoot);
  return SPIRIT_WORKTREE_PATH_PATTERN.test(asPosix);
}

export function resolveSessionWorkLocation(workspaceRoot: string): SessionWorkLocation {
  return isSpiritWorktreeWorkspaceRoot(workspaceRoot) ? 'worktree' : 'local';
}
