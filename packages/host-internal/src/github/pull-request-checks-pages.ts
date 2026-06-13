import type { GitHubPullRequestCheck, GitHubPullRequestCheckState } from './types.js';

const CHECK_STATE_ORDER: Record<GitHubPullRequestCheckState, number> = {
  pending: 0,
  in_progress: 1,
  failure: 2,
  success: 3,
};

export function comparePullRequestChecks(
  left: GitHubPullRequestCheck,
  right: GitHubPullRequestCheck,
): number {
  const requiredDelta = Number(right.required === true) - Number(left.required === true);
  if (requiredDelta !== 0) {
    return requiredDelta;
  }

  const stateDelta =
    (CHECK_STATE_ORDER[left.state] ?? 0) - (CHECK_STATE_ORDER[right.state] ?? 0);
  if (stateDelta !== 0) {
    return stateDelta;
  }

  return left.name.localeCompare(right.name);
}

export function sortPullRequestChecks(checks: GitHubPullRequestCheck[]): GitHubPullRequestCheck[] {
  return [...checks].sort(comparePullRequestChecks);
}

/** Merge a checks pagination page into an existing list by check name. */
export function appendPullRequestChecksPages(
  existing: GitHubPullRequestCheck[],
  incoming: GitHubPullRequestCheck[],
): GitHubPullRequestCheck[] {
  const merged = new Map(existing.map((check) => [check.name, check]));
  for (const check of incoming) {
    merged.set(check.name, check);
  }
  return sortPullRequestChecks(Array.from(merged.values()));
}
