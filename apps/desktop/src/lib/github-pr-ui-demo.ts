import type { GitHubPullRequestDetail } from "@/types";

/** Static PR detail fixture for unauthenticated UI preview only. */
export const GITHUB_PR_DETAIL_DEMO: GitHubPullRequestDetail = {
  number: 42,
  title: "Fix login bug",
  state: "closed",
  url: "https://github.com/octocat/Hello-World/pull/42",
  authorLogin: "octocat",
  headRef: "fix-login",
  baseRef: "main",
  draft: false,
  merged: true,
  mergeable: null,
  labels: [],
  body: "Reproduces when the session cookie expires during OAuth redirect.\n\n- Clear stale tokens on 401\n- Retry device flow once",
};
