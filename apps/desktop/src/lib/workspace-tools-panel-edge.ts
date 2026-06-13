export const WORKSPACE_TOOLS_SPLIT_SELECTOR = "[data-workspace-tools-split]";
export const WORKSPACE_TOOLS_RESIZE_LINE_SELECTOR =
  "#workspace-tools-panel-shell [role='separator'][aria-orientation='vertical'] div[aria-hidden='true']";
export const PR_SUBTAB_SHELL_DIVIDER_ATTR = "data-spirit-pr-subtab-shell-divider";
export const PR_OVERVIEW_SHELL_DIVIDER_ATTR = "data-spirit-pr-overview-shell-divider";
export const WORKSPACE_TOOLS_SHELL_LIST_DIVIDER_HOST_ATTR =
  "data-spirit-workspace-tools-shell-list-divider-host";

export function getWorkspaceToolsShellSplit(): HTMLElement | null {
  return document.querySelector<HTMLElement>(WORKSPACE_TOOLS_SPLIT_SELECTOR);
}

/** Left offset for shell dividers: start at the workspace tools resize line right edge. */
export function getWorkspaceToolsShellDividerLeftPx(shellSplit: HTMLElement): number {
  const shellRect = shellSplit.getBoundingClientRect();
  const resizeLine = document.querySelector<HTMLElement>(WORKSPACE_TOOLS_RESIZE_LINE_SELECTOR);
  const resizeLineRect = resizeLine?.getBoundingClientRect();
  return resizeLineRect ? Math.max(0, resizeLineRect.right - shellRect.left) : 1;
}
