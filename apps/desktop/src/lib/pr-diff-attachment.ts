export type PullRequestChipStatus = "open" | "merged" | "closed" | "draft";

export interface PrDiffAttachment {
  id: string;
  prUrl: string;
  filename: string;
  /** Unified diff new-side line numbers (gutter); frozen at insert time. */
  lineStart: number;
  lineEnd: number;
  /** Git diff-style snippet for the agent. */
  diffText: string;
  /** Frozen at insert time; drives chip colors only. */
  status: PullRequestChipStatus;
}

export function resolvePullRequestChipStatus(detail: {
  merged: boolean;
  state: "open" | "closed";
  draft: boolean;
}): PullRequestChipStatus {
  if (detail.merged) {
    return "merged";
  }
  if (detail.state === "closed") {
    return "closed";
  }
  if (detail.draft) {
    return "draft";
  }
  return "open";
}
