import { parseGitHubPullRequestUrl } from "@spirit-agent/host-internal/github-pull-request-url";

import type { GitHubPullRequestRevealRequest } from "@/lib/workspace-pr-navigation";

export type { GitHubPullRequestUrlRef } from "@spirit-agent/host-internal/github-pull-request-url";

export type OpenPullRequestInPrTab = (request: GitHubPullRequestRevealRequest) => void;

export type TryHandleGitHubPullRequestMarkdownLinkOptions = {
  /** When false, PR URLs fall through to the browser instead of the in-app PR tab. */
  interceptInApp?: boolean;
};

/** Intercept GitHub pull request URLs for in-app PR panel navigation. */
export function tryHandleGitHubPullRequestMarkdownLink(
  href: string,
  openPullRequestInPrTab: OpenPullRequestInPrTab,
  options?: TryHandleGitHubPullRequestMarkdownLinkOptions,
): boolean {
  if (options?.interceptInApp === false) {
    return false;
  }
  const pullRequest = parseGitHubPullRequestUrl(href);
  if (!pullRequest) {
    return false;
  }
  openPullRequestInPrTab(pullRequest);
  return true;
}
