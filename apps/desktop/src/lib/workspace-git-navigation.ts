import {
  addWorkspaceToolTab,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  type WorkspaceToolTab,
} from "@/lib/workspace-tool-tabs";

export type ResolveWorkspaceGitTabResult = {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  gitTabId: string;
};

/** Pick active Git tab, else first Git tab, else create one. */
export function resolveWorkspaceGitTab(
  tabs: readonly WorkspaceToolTab[],
  activeTabId: string,
): ResolveWorkspaceGitTabResult {
  const activeTab = findWorkspaceToolTab(tabs, activeTabId);
  if (activeTab?.kind === "git") {
    return { tabs: [...tabs], activeTabId, gitTabId: activeTabId };
  }

  const firstGitId = focusFirstTabOfKind(tabs, "git");
  if (firstGitId) {
    return { tabs: [...tabs], activeTabId: firstGitId, gitTabId: firstGitId };
  }

  const added = addWorkspaceToolTab(tabs, "git");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    gitTabId: added.activeId,
  };
}
