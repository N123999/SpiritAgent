export type WorkspaceToolTabKind = "files" | "shell" | "git";

export type WorkspaceToolTab = {
  id: string;
  kind: WorkspaceToolTabKind;
};

const KIND_BASE_LABEL_KEY: Record<WorkspaceToolTabKind, string> = {
  files: 'workspace.files',
  shell: 'workspace.shell',
  git: 'workspace.git',
};

function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createWorkspaceToolTab(kind: WorkspaceToolTabKind): WorkspaceToolTab {
  return { id: newTabId(), kind };
}

/** 默认三个选项卡：文件、Shell、Git 各一。 */
export function createDefaultWorkspaceToolTabs(): WorkspaceToolTab[] {
  return [
    createWorkspaceToolTab("files"),
    createWorkspaceToolTab("shell"),
    createWorkspaceToolTab("git"),
  ];
}

export function createInitialWorkspaceToolsState(): {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
} {
  const tabs = createDefaultWorkspaceToolTabs();
  return { tabs, activeTabId: defaultActiveWorkspaceToolTabId(tabs) };
}

export function defaultActiveWorkspaceToolTabId(tabs: WorkspaceToolTab[]): string {
  const files = tabs.find((t) => t.kind === "files");
  return files?.id ?? tabs[0]?.id ?? "";
}

export function workspaceToolTabLabel(
  kind: WorkspaceToolTabKind,
  tabs: readonly WorkspaceToolTab[],
  tabId: string,
  translate: (key: string) => string,
): string {
  const index = tabs.filter((t) => t.kind === kind).findIndex((t) => t.id === tabId);
  const base = translate(KIND_BASE_LABEL_KEY[kind]);
  if (index <= 0) {
    return base;
  }
  return `${base} ${index + 1}`;
}

export function focusFirstTabOfKind(
  tabs: readonly WorkspaceToolTab[],
  kind: WorkspaceToolTabKind,
): string | null {
  return tabs.find((t) => t.kind === kind)?.id ?? null;
}

export function findWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  tabId: string,
): WorkspaceToolTab | undefined {
  return tabs.find((t) => t.id === tabId);
}

export function addWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  kind: WorkspaceToolTabKind,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab(kind);
  return { tabs: [...tabs, tab], activeId: tab.id };
}

export function closeWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  activeId: string,
  closeId: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const closeIndex = tabs.findIndex((t) => t.id === closeId);
  if (closeIndex < 0) {
    return { tabs: [...tabs], activeId };
  }

  const nextTabs = tabs.filter((t) => t.id !== closeId);
  if (nextTabs.length === 0) {
    const defaults = createDefaultWorkspaceToolTabs();
    return { tabs: defaults, activeId: defaultActiveWorkspaceToolTabId(defaults) };
  }

  if (activeId !== closeId) {
    return { tabs: nextTabs, activeId };
  }

  const nextActiveId =
    closeIndex > 0 ? nextTabs[closeIndex - 1]!.id : nextTabs[0]!.id;
  return { tabs: nextTabs, activeId: nextActiveId };
}
