import type { GitHubPullRequestTaskListProgress } from './types.js';

const TASK_LIST_ITEM_PATTERN = /^\s*-\s*\[( |x|X)\]\s/gm;

export function parsePullRequestBodyTaskListProgress(
  body: string | null | undefined,
): GitHubPullRequestTaskListProgress | null {
  if (!body?.trim()) {
    return null;
  }

  let total = 0;
  let completed = 0;

  for (const match of body.matchAll(TASK_LIST_ITEM_PATTERN)) {
    total += 1;
    const marker = match[1];
    if (marker === 'x' || marker === 'X') {
      completed += 1;
    }
  }

  if (total === 0) {
    return null;
  }

  return { total, completed };
}
