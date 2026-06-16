/** Worktree path/branch anchor for subagent tool results (mirrors user_message_at style). */
const SUBAGENT_WORKTREE_OPEN = '<subagent_worktree_at>';
const SUBAGENT_WORKTREE_CLOSE = '</subagent_worktree_at>';

export function formatSubagentWorktreeMetaLine(worktreePath: string, branchName: string): string {
  return `${SUBAGENT_WORKTREE_OPEN}path=${worktreePath},branch=${branchName}${SUBAGENT_WORKTREE_CLOSE}`;
}

export function prependSubagentWorktreeMeta(
  text: string,
  worktreePath?: string,
  branchName?: string,
): string {
  const path = worktreePath?.trim();
  const branch = branchName?.trim();
  if (!path || !branch) {
    return text;
  }
  return `${formatSubagentWorktreeMetaLine(path, branch)}\n${text}`;
}
