import {
  addWorkspaceToolTab,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  type WorkspaceToolTab,
} from "@/lib/workspace-tool-tabs";
import { normalizeWorkspaceEntryRel } from "@/lib/workspace-entry-path-sync";

export type WorkspaceEditorViewMode = "edit" | "preview";

export type EditorFileRevealLocation = {
  line: number;
  column?: number;
};

export type EditorFileTarget =
  | {
      scope: "workspace";
      relativePath: string;
      viewMode: WorkspaceEditorViewMode;
      reveal?: EditorFileRevealLocation;
    }
  | {
      scope: "external";
      absolutePath: string;
      viewMode: WorkspaceEditorViewMode;
      reveal?: EditorFileRevealLocation;
    };

export type WorkspaceFileRevealRequest = {
  relativePath: string;
  viewMode: WorkspaceEditorViewMode;
};

export type ResolveWorkspaceFilesTabResult = {
  tabs: WorkspaceToolTab[];
  activeTabId: string;
  filesTabId: string;
};

/** Pick active files tab, else first files tab, else create one. */
export function resolveWorkspaceFilesTab(
  tabs: readonly WorkspaceToolTab[],
  activeTabId: string,
): ResolveWorkspaceFilesTabResult {
  const activeTab = findWorkspaceToolTab(tabs, activeTabId);
  if (activeTab?.kind === "files") {
    return { tabs: [...tabs], activeTabId, filesTabId: activeTabId };
  }

  const firstFilesId = focusFirstTabOfKind(tabs, "files");
  if (firstFilesId) {
    return { tabs: [...tabs], activeTabId: firstFilesId, filesTabId: firstFilesId };
  }

  const added = addWorkspaceToolTab(tabs, "files");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    filesTabId: added.activeId,
  };
}

export type OpenEditorFileNavigationInput = {
  tabs: readonly WorkspaceToolTab[];
  activeTabId: string;
  target: EditorFileTarget;
};

export type OpenEditorFileNavigationResult = ResolveWorkspaceFilesTabResult & {
  reveal: EditorFileTarget;
};

export function buildOpenEditorFileNavigation(
  input: OpenEditorFileNavigationInput,
): OpenEditorFileNavigationResult {
  const resolved = resolveWorkspaceFilesTab(input.tabs, input.activeTabId);
  return {
    ...resolved,
    reveal: input.target,
  };
}

/** 新建 files 选项卡并聚焦；用于当前页有未保存文件时从文件树打开另一文件。 */
export function buildOpenEditorFileInNewTabNavigation(
  input: OpenEditorFileNavigationInput,
): OpenEditorFileNavigationResult {
  const added = addWorkspaceToolTab(input.tabs, "files");
  return {
    tabs: added.tabs,
    activeTabId: added.activeId,
    filesTabId: added.activeId,
    reveal: input.target,
  };
}

/** 查找已打开指定工作区文件路径的 files 选项卡 id。 */
export function findFilesTabWithWorkspacePath(
  tabs: readonly WorkspaceToolTab[],
  relativePath: string,
): string | undefined {
  const normalized = normalizeWorkspaceEntryRel(relativePath);
  return tabs.find(
    (tab) => tab.kind === "files" && tab.filesWorkspacePath === normalized,
  )?.id;
}

export type OpenWorkspaceFileNavigationInput = {
  tabs: readonly WorkspaceToolTab[];
  activeTabId: string;
  request: WorkspaceFileRevealRequest;
};

export type OpenWorkspaceFileNavigationResult = OpenEditorFileNavigationResult;

export function buildOpenWorkspaceFileNavigation(
  input: OpenWorkspaceFileNavigationInput,
): OpenWorkspaceFileNavigationResult {
  return buildOpenEditorFileNavigation({
    tabs: input.tabs,
    activeTabId: input.activeTabId,
    target: {
      scope: "workspace",
      relativePath: input.request.relativePath,
      viewMode: input.request.viewMode,
    },
  });
}
