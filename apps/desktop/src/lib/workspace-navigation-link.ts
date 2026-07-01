import { normalizeBrowserUrl } from "@/lib/browser-url";
import {
  tryHandleGitHubPullRequestMarkdownLink,
  type OpenPullRequestInPrTab,
} from "@/lib/github-markdown-link";

export type TryHandleDesktopWorkspaceLinkOptions = {
  hostKind?: "electron" | "web";
  /** When false, PR URLs fall through to the in-app browser instead of the PR tab. */
  interceptPrInApp?: boolean;
};

export type DesktopWorkspaceLinkHandlers = {
  openPullRequestInPrTab: OpenPullRequestInPrTab;
  openBrowserUrlInNewTab: (rawUrl: string) => void;
};

/** Intercept workspace links: GitHub PRs open the PR tab; other http(s) URLs open the browser tab. */
export function tryHandleDesktopWorkspaceLink(
  href: string,
  handlers: DesktopWorkspaceLinkHandlers,
  options?: TryHandleDesktopWorkspaceLinkOptions,
): boolean {
  if (href.trim().startsWith("#")) {
    return false;
  }

  if (
    tryHandleGitHubPullRequestMarkdownLink(href, handlers.openPullRequestInPrTab, {
      interceptInApp: options?.interceptPrInApp,
    })
  ) {
    return true;
  }

  if (options?.hostKind !== "electron") {
    return false;
  }

  const url = normalizeBrowserUrl(href);
  if (!url) {
    return false;
  }

  handlers.openBrowserUrlInNewTab(url);
  return true;
}
