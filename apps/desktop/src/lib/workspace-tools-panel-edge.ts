import { viewportLengthToScaleRootLocal } from "@/lib/ui-layout-scale";

export const WORKSPACE_TOOLS_SPLIT_SELECTOR = "[data-workspace-tools-split]";
export const WORKSPACE_TOOLS_RESIZE_LINE_SELECTOR =
  "#workspace-tools-panel-shell [role='separator'][aria-orientation='vertical'] div[aria-hidden='true']";
export const PR_SUBTAB_SHELL_DIVIDER_ATTR = "data-spirit-pr-subtab-shell-divider";
export const PR_LIST_SEARCH_SHELL_DIVIDER_ATTR = "data-spirit-pr-list-search-shell-divider";
export const PR_OVERVIEW_SHELL_DIVIDER_ATTR = "data-spirit-pr-overview-shell-divider";
export const FILES_EXPLORER_TOOLBAR_SHELL_DIVIDER_ATTR =
  "data-spirit-files-explorer-toolbar-shell-divider";
export const WORKSPACE_TOOL_TABS_SHELL_DIVIDER_ATTR =
  "data-spirit-workspace-tool-tabs-shell-divider";
export const GIT_CHANGES_HEADER_SHELL_DIVIDER_ATTR =
  "data-spirit-git-changes-header-shell-divider";
export const GIT_CHANGES_HISTORY_SPLIT_SHELL_DIVIDER_ATTR =
  "data-spirit-git-changes-history-split-shell-divider";
export const GIT_HISTORY_HEADER_SHELL_DIVIDER_ATTR =
  "data-spirit-git-history-header-shell-divider";
export const BROWSER_NAV_SHELL_DIVIDER_ATTR = "data-spirit-browser-nav-shell-divider";
export const WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR =
  "data-spirit-workspace-tools-shell-list-divider-host";

export function getWorkspaceToolsShellSplit(): HTMLElement | null {
  return document.querySelector<HTMLElement>(WORKSPACE_TOOLS_SPLIT_SELECTOR);
}

/** shellSplit 内 absolute 定位须用本地长度，不可直接用 getBoundingClientRect 视口差值。 */
export function shellLocalLengthFromViewportDelta(delta: number): number {
  return viewportLengthToScaleRootLocal(delta);
}

/** Left offset for shell dividers: start at the workspace tools resize line right edge. */
export function getWorkspaceToolsShellDividerLeftPx(shellSplit: HTMLElement): number {
  const shellRect = shellSplit.getBoundingClientRect();
  const resizeLine = document.querySelector<HTMLElement>(WORKSPACE_TOOLS_RESIZE_LINE_SELECTOR);
  const resizeLineRect = resizeLine?.getBoundingClientRect();
  const viewportDelta = resizeLineRect ? Math.max(0, resizeLineRect.right - shellRect.left) : 1;
  return shellLocalLengthFromViewportDelta(viewportDelta);
}
