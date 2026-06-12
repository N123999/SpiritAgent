import { useCallback, useEffect, useRef, useState } from "react";

import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import { readWorkspaceToolsWidthPx } from "@/lib/layout-prefs";
import {
  addWorkspaceBrowserTabWithUrl,
  addWorkspaceToolTab,
  createInitialWorkspaceToolsState,
  findWorkspaceToolTab,
  focusFirstTabOfKind,
  normalizeWorkspaceToolTabsForHost,
} from "@/lib/workspace-tool-tabs";
import {
  buildOpenEditorFileNavigation,
  type EditorFileTarget,
  type WorkspaceEditorViewMode,
} from "@/lib/workspace-editor-navigation";
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
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
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
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(readWorkspaceToolsWidthPx);

  const openBrowserUrlInNewTab = useCallback((rawUrl: string) => {
    if (runtime.hostKind !== "electron") {
      return;
    }
    const url = normalizeBrowserUrl(rawUrl);
    if (!url) {
      return;
    }
    setWorkspaceToolsOpen(true);
    let nextActiveId = "";
    setWorkspaceToolTabs((prev) => {
      const next = addWorkspaceBrowserTabWithUrl(prev, url);
      nextActiveId = next.activeId;
      return next.tabs;
    });
    if (nextActiveId) {
      setActiveWorkspaceToolTabId(nextActiveId);
    }
  }, [runtime.hostKind]);

  const openEditorFile = useCallback((target: EditorFileTarget) => {
    const navigation = buildOpenEditorFileNavigation({
      tabs: workspaceToolTabsRef.current,
      activeTabId: activeWorkspaceToolTabIdRef.current,
      target,
    });
    setWorkspaceToolsOpen(true);
    setWorkspaceToolTabs(navigation.tabs);
    setActiveWorkspaceToolTabId(navigation.activeTabId);
    setWorkspaceFileRevealTargetId(navigation.filesTabId);
    setWorkspaceFileRevealScope(target.scope);
    setWorkspaceFileRevealViewMode(target.viewMode);
    if (target.scope === "workspace") {
      setWorkspaceFileRevealPath(target.relativePath);
      setWorkspaceFileRevealAbsolutePath("");
    } else {
      setWorkspaceFileRevealPath("");
      setWorkspaceFileRevealAbsolutePath(target.absolutePath);
    }
    setWorkspaceFileRevealNonce((value) => value + 1);
  }, []);

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
    workspaceToolsOpen,
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
    openBrowserUrlInNewTab,
    openEditorFile,
    openWorkspaceFile,
  };
}
