import type { TFunction } from "i18next";

import type { DesktopSnapshot } from "@/types";

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

export function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

/** Display label for greeting interpolation; null when no workspace is bound. */
export function resolveWorkspaceDisplayLabel(
  workspaceRoot: string,
  workspaceBinding: DesktopSnapshot["workspaceBinding"],
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"],
): string | null {
  if (workspaceBinding === "none" || !workspaceRoot.trim()) {
    return null;
  }
  const matched = availableWorkspaces.find((workspace) =>
    sameWorkspacePath(workspace.path, workspaceRoot),
  );
  return matched?.label ?? deriveWorkspaceLabel(workspaceRoot);
}

/** Selector label including the no-workspace binding state. */
export function resolveWorkspaceSelectorLabel(
  workspaceRoot: string,
  workspaceBinding: DesktopSnapshot["workspaceBinding"],
  availableWorkspaces: DesktopSnapshot["availableWorkspaces"],
  t: TFunction,
): string {
  if (workspaceBinding === "none") {
    return t("app.noWorkspace");
  }
  return resolveWorkspaceDisplayLabel(workspaceRoot, workspaceBinding, availableWorkspaces) ?? "";
}
