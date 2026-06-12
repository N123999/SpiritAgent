import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BROWSER_NEW_TAB_SENTINEL,
  addWorkspaceToolTab,
  closeWorkspaceToolTab,
  createDefaultWorkspaceToolTabs,
  createInitialWorkspaceToolsState,
  createWorkspaceToolTab,
  defaultActiveWorkspaceToolTabId,
  focusFirstTabOfKind,
  isBrowserNewTabUrl,
  normalizeWorkspaceToolTabsForHost,
  workspaceToolTabLabel,
} from "../src/lib/workspace-tool-tabs.ts";

const t = (key) =>
  ({
    "workspace.files": "文件",
    "workspace.shell": "Shell",
    "workspace.browser": "浏览器",
    "workspace.prTab": "Pull Request",
  })[key] ?? key;

test("createDefaultWorkspaceToolTabs has files, shell, and git", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  assert.equal(tabs.length, 3);
  const kinds = tabs.map((t) => t.kind);
  assert.deepEqual(kinds, ["files", "shell", "git"]);
  assert.ok(tabs.every((t) => typeof t.id === "string" && t.id.length > 0));
});

test("workspaceToolTabLabel numbers duplicate kinds", () => {
  const a = createWorkspaceToolTab("files");
  const b = createWorkspaceToolTab("files");
  const tabs = [a, b];
  assert.equal(workspaceToolTabLabel("files", tabs, a.id, t), "文件");
  assert.equal(workspaceToolTabLabel("files", tabs, b.id, t), "文件 2");
  assert.equal(workspaceToolTabLabel("shell", tabs, createWorkspaceToolTab("shell").id, t), "Shell");
});

test("createWorkspaceToolTab browser defaults to new-tab sentinel", () => {
  const tab = createWorkspaceToolTab("browser");
  assert.equal(tab.kind, "browser");
  assert.equal(tab.browserUrl, BROWSER_NEW_TAB_SENTINEL);
  assert.equal(isBrowserNewTabUrl(tab.browserUrl), true);
});

test("addWorkspaceToolTab browser includes sentinel url", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "browser");
  const browserTab = next.find((item) => item.id === activeId);
  assert.equal(browserTab?.kind, "browser");
  assert.equal(browserTab?.browserUrl, BROWSER_NEW_TAB_SENTINEL);
});

test("focusFirstTabOfKind returns first matching id", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const filesId = focusFirstTabOfKind(tabs, "files");
  assert.equal(filesId, tabs[0].id);
  assert.equal(focusFirstTabOfKind([], "files"), null);
});

test("addWorkspaceToolTab appends and focuses new tab", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "shell");
  assert.equal(next.length, 4);
  assert.equal(next.at(-1)?.kind, "shell");
  assert.equal(activeId, next.at(-1)?.id);
});

test("closeWorkspaceToolTab restores defaults when last tab closes", () => {
  let tabs = [createWorkspaceToolTab("shell")];
  let activeId = tabs[0].id;
  const closed = closeWorkspaceToolTab(tabs, activeId, activeId);
  tabs = closed.tabs;
  activeId = closed.activeId;
  assert.equal(tabs.length, 3);
  assert.deepEqual(
    tabs.map((t) => t.kind),
    ["files", "shell", "git"],
  );
  assert.equal(activeId, focusFirstTabOfKind(tabs, "files"));
});

test("closeWorkspaceToolTab prefers left neighbor for active tab", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const shellId = tabs[1].id;
  const closed = closeWorkspaceToolTab(tabs, shellId, shellId);
  assert.equal(closed.activeId, tabs[0].id);
  assert.equal(closed.tabs.length, 2);
});

test("defaultActiveWorkspaceToolTabId prefers files", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  assert.equal(defaultActiveWorkspaceToolTabId(tabs), tabs[0].id);
});

test("createDefaultWorkspaceToolTabs can include browser on Electron", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  assert.equal(tabs.length, 4);
  assert.deepEqual(
    tabs.map((t) => t.kind),
    ["files", "shell", "git", "browser"],
  );
});

test("normalizeWorkspaceToolTabsForHost strips browser on web host", () => {
  const tabs = createDefaultWorkspaceToolTabs({ includeBrowser: true });
  const browserTab = tabs.find((t) => t.kind === "browser");
  assert.ok(browserTab);
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, browserTab.id, false);
  assert.equal(normalized.tabs.some((t) => t.kind === "browser"), false);
  assert.equal(normalized.tabs.length, 3);
  assert.equal(normalized.activeId, normalized.tabs[0].id);
});

test("normalizeWorkspaceToolTabsForHost adds browser on electron host", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, tabs[0].id, true);
  assert.equal(normalized.tabs.length, 4);
  assert.equal(normalized.tabs.some((t) => t.kind === "browser"), true);
});

test("addWorkspaceToolTab can append pr tab", () => {
  const tabs = createDefaultWorkspaceToolTabs();
  const { tabs: next, activeId } = addWorkspaceToolTab(tabs, "pr");
  assert.equal(next.at(-1)?.kind, "pr");
  assert.equal(activeId, next.at(-1)?.id);
});

test("normalizeWorkspaceToolTabsForHost strips pr on web host", () => {
  const tabs = [...createDefaultWorkspaceToolTabs(), createWorkspaceToolTab("pr")];
  const prTab = tabs.find((tab) => tab.kind === "pr");
  assert.ok(prTab);
  const normalized = normalizeWorkspaceToolTabsForHost(tabs, prTab.id, false, false);
  assert.equal(normalized.tabs.some((tab) => tab.kind === "pr"), false);
});

test("workspaceToolTabLabel supports pr tab", () => {
  const tab = createWorkspaceToolTab("pr");
  assert.equal(workspaceToolTabLabel("pr", [tab], tab.id, t), "Pull Request");
});

test("createInitialWorkspaceToolsState uses same tabs for active id", () => {
  const { tabs, activeTabId } = createInitialWorkspaceToolsState();
  assert.ok(tabs.some((t) => t.id === activeTabId));
  assert.equal(tabs.find((t) => t.id === activeTabId)?.kind, "files");
});
