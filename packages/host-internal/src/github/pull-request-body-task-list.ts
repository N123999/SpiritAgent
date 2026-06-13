import type { GitHubPullRequestTaskListProgress } from './types.js';

const TASK_LIST_ITEM_PATTERN = /^\s*-\s*\[( |x|X)\]\s/gm;
const FENCED_CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

function stripFencedCodeBlocks(body: string): string {
  return body.replace(FENCED_CODE_BLOCK_PATTERN, '');
}

export function parsePullRequestBodyTaskListProgress(
  body: string | null | undefined,
): GitHubPullRequestTaskListProgress | null {
  if (!body?.trim()) {
    return null;
  }

  const scannableBody = stripFencedCodeBlocks(body);

  let total = 0;
  let completed = 0;

  for (const match of scannableBody.matchAll(TASK_LIST_ITEM_PATTERN)) {
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
