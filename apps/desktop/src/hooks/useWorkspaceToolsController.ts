import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceToolsChromeActions } from "@/contexts/workspace-tools-chrome-context";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import { readWorkspaceToolsWidthPx } from "@/lib/layout-prefs";
import {
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  normalizeWorkspaceToolTabsForHost,
  openBrowserUrlInWorkspaceTabs,
} from "@/lib/workspace-tool-tabs";
import {
  buildOpenEditorFileInNewTabNavigation,
  buildOpenEditorFileNavigation,
  resolveWorkspaceFilesTab,
  type EditorFileTarget,
  type WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
import {
  buildOpenPullRequestNavigation,
  type GitHubPullRequestRevealRequest,
} from "@/lib/workspace-pr-navigation";
import { resolveWorkspaceGitTab } from "@/lib/workspace-git-navigation";
import type { DesktopSnapshot } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;

export type UseWorkspaceToolsControllerOptions = {
  runtime: DesktopRuntime;
  snapshot: DesktopSnapshot | null;
  activeFilePath: string | null;
};

export function useWorkspaceToolsController({
  runtime,
  snapshot,
  activeFilePath,
}: UseWorkspaceToolsControllerOptions) {
  const { setOpen: setWorkspaceToolsOpen } = useWorkspaceToolsChromeActions();
  const initialWorkspaceToolsRef = useRef<ReturnType<
    typeof createInitialWorkspaceToolsState
  > | null>(null);
  if (initialWorkspaceToolsRef.current === null) {
    initialWorkspaceToolsRef.current = createInitialWorkspaceToolsState(false);
  }
  const initialWorkspaceTools = initialWorkspaceToolsRef.current;
  const [workspaceToolTabs, setWorkspaceToolTabs] = useState(() => initialWorkspaceTools.tabs);
  const [activeWorkspaceToolTabId, setActiveWorkspaceToolTabId] = useState(
    () => initialWorkspaceTools.activeTabId,
  );
  const activeWorkspaceToolTabIdRef = useRef(activeWorkspaceToolTabId);
  activeWorkspaceToolTabIdRef.current = activeWorkspaceToolTabId;
  const workspaceToolTabsRef = useRef(workspaceToolTabs);
  workspaceToolTabsRef.current = workspaceToolTabs;
  const workspaceToolsHostSyncedRef = useRef<typeof runtime.hostKind | null>(null);
  const browserTabEnabled = runtime.hostKind === "electron";
  const prTabEnabled = runtime.hostKind === "electron";
  const [workspaceFilesPlanRevealNonce, setWorkspaceFilesPlanRevealNonce] = useState(0);
  const [workspaceFilesPlanRevealTargetId, setWorkspaceFilesPlanRevealTargetId] = useState<
    string | null
  >(null);
  const [workspaceFileRevealNonce, setWorkspaceFileRevealNonce] = useState(0);
  const [workspaceFileRevealTargetId, setWorkspaceFileRevealTargetId] = useState<string | null>(
    null,
  );
  const [workspaceFileRevealPath, setWorkspaceFileRevealPath] = useState("");
  const [workspaceFileRevealAbsolutePath, setWorkspaceFileRevealAbsolutePath] = useState("");
  const [workspaceFileRevealScope, setWorkspaceFileRevealScope] = useState<
    EditorFileTarget["scope"]
  >("workspace");
  const [workspaceFileRevealViewMode, setWorkspaceFileRevealViewMode] =
    useState<WorkspaceEditorViewMode>("edit");
  const [workspaceFileRevealDirectoryOnly, setWorkspaceFileRevealDirectoryOnly] = useState(false);
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(readWorkspaceToolsWidthPx);
  const [workspacePrRevealNonce, setWorkspacePrRevealNonce] = useState(0);
  const [workspacePrRevealTargetId, setWorkspacePrRevealTargetId] = useState<string | null>(null);
  const [workspacePrRevealRequest, setWorkspacePrRevealRequest] =
    useState<GitHubPullRequestRevealRequest | null>(null);

  const openBrowserUrlInNewTab = useCallback((rawUrl: string) => {
    if (runtime.hostKind !== "electron") {
      return;
    }
    const url = normalizeBrowserUrl(rawUrl);
    if (!url) {
      return;
    }
    const navigation = openBrowserUrlInWorkspaceTabs(workspaceToolTabsRef.current, url);
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeId);
  }, [runtime.hostKind]);

  const revealEditorFile = useCallback((navigation: ReturnType<typeof buildOpenEditorFileNavigation>) => {
    const target = navigation.reveal;
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspaceFileRevealTargetId(navigation.filesTabId);
    setWorkspaceFileRevealScope(target.scope);
    setWorkspaceFileRevealViewMode(target.viewMode);
    setWorkspaceFileRevealDirectoryOnly(false);
    if (target.scope === "workspace") {
      setWorkspaceFileRevealPath(target.relativePath);
      setWorkspaceFileRevealAbsolutePath("");
    } else {
      setWorkspaceFileRevealPath("");
      setWorkspaceFileRevealAbsolutePath(target.absolutePath);
    }
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, [setWorkspaceToolsOpen]);

  const openEditorFile = useCallback(
    (target: EditorFileTarget) => {
      revealEditorFile(
        buildOpenEditorFileNavigation({
          tabs: workspaceToolTabsRef.current,
          activeTabId: activeWorkspaceToolTabIdRef.current,
          target,
        }),
      );
    },
    [revealEditorFile],
  );

  const openWorkspaceFile = useCallback(
    (relativePath: string, options?: { viewMode?: WorkspaceEditorViewMode }) => {
      openEditorFile({
        scope: "workspace",
        relativePath,
        viewMode: options?.viewMode ?? "edit",
      });
    },
    [openEditorFile],
  );

  const openWorkspaceFileInNewTab = useCallback(
    (relativePath: string, options?: { viewMode?: WorkspaceEditorViewMode }) => {
      revealEditorFile(
        buildOpenEditorFileInNewTabNavigation({
          tabs: workspaceToolTabsRef.current,
          activeTabId: activeWorkspaceToolTabIdRef.current,
          target: {
            scope: "workspace",
            relativePath,
            viewMode: options?.viewMode ?? "edit",
          },
        }),
      );
    },
    [revealEditorFile],
  );

  const revealWorkspaceDirectory = useCallback((relativePath: string) => {
    const navigation = resolveWorkspaceFilesTab(
      workspaceToolTabsRef.current,
      activeWorkspaceToolTabIdRef.current,
    );
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspaceFileRevealTargetId(navigation.filesTabId);
    setWorkspaceFileRevealScope("workspace");
    setWorkspaceFileRevealDirectoryOnly(true);
    setWorkspaceFileRevealPath(relativePath.replace(/\/+$/u, ""));
    setWorkspaceFileRevealAbsolutePath("");
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, []);

  const openPullRequestInPrTab = useCallback((request: GitHubPullRequestRevealRequest) => {
    if (runtime.hostKind !== "electron") {
      return;
    }
    const navigation = buildOpenPullRequestNavigation({
      tabs: workspaceToolTabsRef.current,
      activeTabId: activeWorkspaceToolTabIdRef.current,
      request,
    });
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspacePrRevealTargetId(navigation.prTabId);
    setWorkspacePrRevealRequest(navigation.request);
    setWorkspacePrRevealNonce((value) => value + 1);
  }, [runtime.hostKind]);

  const openGitTab = useCallback(() => {
    const navigation = resolveWorkspaceGitTab(
      workspaceToolTabsRef.current,
      activeWorkspaceToolTabIdRef.current,
    );
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
  }, []);

  useEffect(() => {
    if (!runtime.apiReady || runtime.hostKind == null) {
      return;
    }
    if (workspaceToolsHostSyncedRef.current === runtime.hostKind) {
      return;
    }
    workspaceToolsHostSyncedRef.current = runtime.hostKind;
    const includeBrowser = runtime.hostKind === "electron";
    setWorkspaceToolTabs((prev) => {
      const normalized = normalizeWorkspaceToolTabsForHost(
        prev,
        activeWorkspaceToolTabIdRef.current,
        includeBrowser,
      );
      if (normalized.activeId !== activeWorkspaceToolTabIdRef.current) {
        setActiveWorkspaceToolTabId(normalized.activeId);
      }
      return normalized.tabs;
    });
  }, [runtime.apiReady, runtime.hostKind]);

  useEffect(() => {
    const bridge = window.spiritDesktop;
    if (!bridge?.subscribeBrowserOpenUrl) {
      return;
    }
    return bridge.subscribeBrowserOpenUrl(openBrowserUrlInNewTab);
  }, [openBrowserUrlInNewTab]);

  const previousPlanModifiedAtRef = useRef<number | undefined>(undefined);
  const previousPlanExistsRef = useRef<boolean | undefined>(undefined);
  const previousActiveSessionPathRef = useRef<string | null>(null);

  useEffect(() => {
    const plan = snapshot?.plan;
    const sessionPath = snapshot?.activeSession?.filePath ?? null;
    if (!plan) {
      return;
    }

    const sessionChanged =
      previousActiveSessionPathRef.current !== null &&
      previousActiveSessionPathRef.current !== sessionPath;

    const previousExists = previousPlanExistsRef.current;
    const previousModifiedAt = previousPlanModifiedAtRef.current;

    previousActiveSessionPathRef.current = sessionPath;
    previousPlanExistsRef.current = plan.exists;
    previousPlanModifiedAtRef.current = plan.modifiedAtUnixMs;

    if (sessionChanged) {
      return;
    }

    const created = previousExists === false && plan.exists;
    const modified =
      plan.exists &&
      plan.modifiedAtUnixMs !== undefined &&
      previousModifiedAt !== undefined &&
      plan.modifiedAtUnixMs !== previousModifiedAt;

    if (!created && !modified) {
      return;
    }

    setWorkspaceToolsOpen(true);

    const activeTab = findWorkspaceToolTab(workspaceToolTabs, activeWorkspaceToolTabId);
    let targetFilesTabId: string;
    if (activeTab?.kind === "files") {
      targetFilesTabId = activeWorkspaceToolTabId;
    } else {
      const firstFilesId = focusFirstTabOfKind(workspaceToolTabs, "files");
      if (firstFilesId) {
        targetFilesTabId = firstFilesId;
        setActiveWorkspaceToolTabId(firstFilesId);
      } else {
        const added = addWorkspaceToolTab(workspaceToolTabs, "files");
        setWorkspaceToolTabs(added.tabs);
        setActiveWorkspaceToolTabId(added.activeId);
        targetFilesTabId = added.activeId;
      }
    }

    setWorkspaceFilesPlanRevealTargetId(targetFilesTabId);
    setWorkspaceFilesPlanRevealNonce((value) => value + 1);
  }, [
    activeFilePath,
    activeWorkspaceToolTabId,
    snapshot?.plan?.exists,
    snapshot?.plan?.modifiedAtUnixMs,
    snapshot?.plan,
    workspaceToolTabs,
  ]);

  return {
    setWorkspaceToolsOpen,
    workspaceToolTabs,
    setWorkspaceToolTabs,
    activeWorkspaceToolTabId,
    setActiveWorkspaceToolTabId,
    workspaceToolsWidthPx,
    setWorkspaceToolsWidthPx,
    browserTabEnabled,
    prTabEnabled,
    workspaceFilesPlanRevealNonce,
    workspaceFilesPlanRevealTargetId,
    workspaceFileRevealNonce,
    workspaceFileRevealTargetId,
    workspaceFileRevealPath,
    workspaceFileRevealAbsolutePath,
    workspaceFileRevealScope,
    workspaceFileRevealViewMode,
    workspaceFileRevealDirectoryOnly,
    openBrowserUrlInNewTab,
    openEditorFile,
    openWorkspaceFile,
    openWorkspaceFileInNewTab,
    revealWorkspaceDirectory,
    openPullRequestInPrTab,
    openGitTab,
    workspacePrRevealNonce,
    workspacePrRevealTargetId,
    workspacePrRevealRequest,
  };
}
