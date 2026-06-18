export type WorkspaceToolTabKind = "files" | "shell" | "git" | "browser" | "pr";

export const BROWSER_NEW_TAB_SENTINEL = "__spirit_browser_new_tab__";

export type WorkspaceToolTab = {
  id: string;
  kind: WorkspaceToolTabKind;
  /** 仅 kind === "browser" 时使用；sentinel 表示内置新标签页 */
  browserUrl?: string;
  /** 由各子 Tab 组件上报的当前标题（文件名 / 网页标题 / 终端标题）；空时仅显示图标 */
  tabTitle?: string;
};

const KIND_BASE_LABEL_KEY: Record<WorkspaceToolTabKind, string> = {
  files: 'workspace.files',
  shell: 'workspace.shell',
  git: 'workspace.gitTab',
  browser: 'workspace.browser',
  pr: 'workspace.prTab',
};

function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isBrowserNewTabUrl(url: string | undefined): boolean {
  return url === BROWSER_NEW_TAB_SENTINEL || url === undefined || url === "";
}

export function createWorkspaceToolTab(kind: WorkspaceToolTabKind): WorkspaceToolTab {
  const tab: WorkspaceToolTab = { id: newTabId(), kind };
  if (kind === "browser") {
    tab.browserUrl = BROWSER_NEW_TAB_SENTINEL;
  }
  return tab;
}

export type WorkspaceToolTabsDefaultsOptions = {
  /** Electron 桌面版默认包含浏览器选项卡；Web 宿主仅文件 / Shell / Git。 */
  includeBrowser?: boolean;
};

/** 默认工作区选项卡：文件、Shell、Git；Electron 可额外包含浏览器。 */
export function createDefaultWorkspaceToolTabs(
  options: WorkspaceToolTabsDefaultsOptions = {},
): WorkspaceToolTab[] {
  const kinds: WorkspaceToolTabKind[] = ["files", "shell", "git"];
  if (options.includeBrowser) {
    kinds.push("browser");
  }
  return kinds.map((kind) => createWorkspaceToolTab(kind));
}

export function createInitialWorkspaceToolsState(
  includeBrowser = false,
): {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
} {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser });
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

/** Chip 显示名：优先 OSC 终端标题，否则 i18n 默认 Terminal（多 tab 加序号）。 */
export function workspaceTerminalChipDisplayName(
  tab: WorkspaceToolTab,
  tabs: readonly WorkspaceToolTab[],
  translate: (key: string) => string,
): string {
  const titled = tab.tabTitle?.trim();
  if (titled) {
    return titled;
  }
  const index = tabs.filter((item) => item.kind === "shell").findIndex((item) => item.id === tab.id);
  const base = translate("workspace.terminalChipDefaultName");
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
  tabTitle?: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab(kind);
  if (tabTitle) {
    tab.tabTitle = tabTitle;
  }
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** 打开 URL：优先复用无标题的空浏览器 tab，否则新建。 */
export function openBrowserUrlInWorkspaceTabs(
  tabs: readonly WorkspaceToolTab[],
  url: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const vacant = tabs.find((tab) => tab.kind === "browser" && !tab.tabTitle?.trim());
  if (vacant) {
    return {
      tabs: tabs.map((tab) => (tab.id === vacant.id ? { ...tab, browserUrl: url } : tab)),
      activeId: vacant.id,
    };
  }
  return addWorkspaceBrowserTabWithUrl(tabs, url);
}

/** 新建浏览器子标签并直接带上目标 URL（避免先落在新标签页 sentinel 再二次更新）。 */
export function addWorkspaceBrowserTabWithUrl(
  tabs: readonly WorkspaceToolTab[],
  url: string,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const tab = createWorkspaceToolTab("browser");
  tab.browserUrl = url;
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** 按宿主能力补齐或移除浏览器选项卡，并修正 activeId。 */
export function normalizeWorkspaceToolTabsForHost(
  tabs: readonly WorkspaceToolTab[],
  activeId: string,
  includeBrowser: boolean,
  includePr = false,
): { tabs: WorkspaceToolTab[]; activeId: string } {
  let nextTabs = [...tabs];

  if (!includePr) {
    nextTabs = nextTabs.filter((tab) => tab.kind !== "pr");
  }

  if (includeBrowser) {
    if (!nextTabs.some((tab) => tab.kind === "browser")) {
      nextTabs = [...nextTabs, createWorkspaceToolTab("browser")];
    }
  } else {
    const withoutBrowser = nextTabs.filter((tab) => tab.kind !== "browser");
    nextTabs =
      withoutBrowser.length > 0
        ? withoutBrowser
        : createDefaultWorkspaceToolTabs({ includeBrowser: false });
  }

  const activeStillValid = nextTabs.some((tab) => tab.id === activeId);
  return {
    tabs: nextTabs,
    activeId: activeStillValid ? activeId : defaultActiveWorkspaceToolTabId(nextTabs),
  };
}

export function closeWorkspaceToolTab(
  tabs: readonly WorkspaceToolTab[],
  activeId: string,
  closeId: string,
  options: WorkspaceToolTabsDefaultsOptions = {},
): { tabs: WorkspaceToolTab[]; activeId: string } {
  const closeIndex = tabs.findIndex((t) => t.id === closeId);
  if (closeIndex < 0) {
    return { tabs: [...tabs], activeId };
  }

  const nextTabs = tabs.filter((t) => t.id !== closeId);
  if (nextTabs.length === 0) {
    const defaults = createDefaultWorkspaceToolTabs(options);
    return { tabs: defaults, activeId: defaultActiveWorkspaceToolTabId(defaults) };
  }

  if (activeId !== closeId) {
    return { tabs: nextTabs, activeId };
  }

  const nextActiveId =
    closeIndex > 0 ? nextTabs[closeIndex - 1]!.id : nextTabs[0]!.id;
  return { tabs: nextTabs, activeId: nextActiveId };
}
