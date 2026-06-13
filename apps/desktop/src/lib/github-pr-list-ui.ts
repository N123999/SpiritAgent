import type { GitHubPullRequestTaskListProgress } from "@/types";

export type PrTestPlanProgressVariant = "none" | "zero" | "partial" | "complete";

export function resolvePrTestPlanProgressVariant(
  progress: GitHubPullRequestTaskListProgress | null | undefined,
): PrTestPlanProgressVariant {
  if (!progress || progress.total <= 0) {
    return "none";
  }
  if (progress.completed === 0) {
    return "zero";
  }
  if (progress.completed < progress.total) {
    return "partial";
  }
  return "complete";
}

export type PullRequestListIconTone = "merged" | "draft" | "open" | "closed";

export function resolvePullRequestListIconTone(item: {
  merged: boolean;
  draft?: boolean;
  state: "open" | "closed";
}): PullRequestListIconTone {
  if (item.merged) {
    return "merged";
  }
  if (item.draft) {
    return "draft";
  }
  if (item.state === "open") {
    return "open";
  }
  return "closed";
}
