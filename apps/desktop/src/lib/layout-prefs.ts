import {
  SESSION_SIDEBAR_MIN_WIDTH_PX,
  computeSessionSidebarMaxWidthPx,
} from "@/lib/desktop-chrome";

const SESSION_SIDEBAR_WIDTH_STORAGE_KEY = "spirit-desktop-session-sidebar-width-px";

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStoredPositiveInt(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    if (typeof localStorage === "undefined") {
      return fallback;
    }
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return clampInt(parsed, min, max);
    }
  } catch {
    // ignore
  }
  return fallback;
}

function writeStoredPositiveInt(key: string, value: number): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // ignore
  }
}

export function readSessionSidebarWidthPx(): number {
  const max = computeSessionSidebarMaxWidthPx();
  return readStoredPositiveInt(
    SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
    SESSION_SIDEBAR_MIN_WIDTH_PX,
    SESSION_SIDEBAR_MIN_WIDTH_PX,
    max,
  );
}

export function writeSessionSidebarWidthPx(widthPx: number): void {
  const max = computeSessionSidebarMaxWidthPx();
  writeStoredPositiveInt(
    SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
    clampInt(widthPx, SESSION_SIDEBAR_MIN_WIDTH_PX, max),
  );
}

const WORKSPACE_TOOLS_WIDTH_STORAGE_KEY = "spirit-desktop-workspace-tools-width-px";

export const WORKSPACE_TOOLS_MIN_WIDTH_PX = 240;
export const WORKSPACE_TOOLS_DEFAULT_WIDTH_PX = 420;
const WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO = 0.62;

export function computeWorkspaceToolsMaxWidthPx(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  return Math.round(viewportWidthPx * WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO);
}

export function readWorkspaceToolsWidthPx(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  const max = computeWorkspaceToolsMaxWidthPx(viewportWidthPx);
  return readStoredPositiveInt(
    WORKSPACE_TOOLS_WIDTH_STORAGE_KEY,
    WORKSPACE_TOOLS_DEFAULT_WIDTH_PX,
    WORKSPACE_TOOLS_MIN_WIDTH_PX,
    max,
  );
}

export function writeWorkspaceToolsWidthPx(widthPx: number): void {
  const max = computeWorkspaceToolsMaxWidthPx();
  writeStoredPositiveInt(
    WORKSPACE_TOOLS_WIDTH_STORAGE_KEY,
    clampInt(widthPx, WORKSPACE_TOOLS_MIN_WIDTH_PX, max),
  );
}

const GIT_CHANGES_PANE_RATIO_STORAGE_KEY = "spirit-desktop-git-changes-pane-ratio";

export const GIT_CHANGES_DEFAULT_RATIO = 0.45;
const GIT_CHANGES_RATIO_LOOSE_MIN = 0.15;
const GIT_CHANGES_RATIO_LOOSE_MAX = 0.85;

export const GIT_CHANGES_MIN_PX = 88;
export const GIT_HISTORY_MIN_PX = 120;
export const GIT_HISTORY_HEADER_PX = 32;
export const GIT_SPLITTER_PX = 4;

function clampRatio(ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ratio));
}

export function computeGitChangesPaneRatioBounds(containerHeightPx: number): {
  min: number;
  max: number;
} {
  const min = GIT_CHANGES_MIN_PX / containerHeightPx;
  const max =
    (containerHeightPx - GIT_HISTORY_MIN_PX - GIT_HISTORY_HEADER_PX - GIT_SPLITTER_PX) /
    containerHeightPx;
  return { min, max };
}

export function clampGitChangesPaneRatio(
  ratio: number,
  containerHeightPx?: number,
): number {
  if (containerHeightPx && containerHeightPx > 0) {
    const { min, max } = computeGitChangesPaneRatioBounds(containerHeightPx);
    if (min <= max) {
      return clampRatio(ratio, min, max);
    }
  }
  return clampRatio(ratio, GIT_CHANGES_RATIO_LOOSE_MIN, GIT_CHANGES_RATIO_LOOSE_MAX);
}

function readStoredRatio(
  key: string,
  fallback: number,
  containerHeightPx?: number,
): number {
  try {
    if (typeof localStorage === "undefined") {
      return fallback;
    }
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return clampGitChangesPaneRatio(parsed, containerHeightPx);
    }
  } catch {
    // ignore
  }
  return fallback;
}

function writeStoredRatio(key: string, ratio: number, containerHeightPx?: number): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(
      key,
      String(clampGitChangesPaneRatio(ratio, containerHeightPx)),
    );
  } catch {
    // ignore
  }
}

export function readGitChangesPaneRatio(containerHeightPx?: number): number {
  return readStoredRatio(
    GIT_CHANGES_PANE_RATIO_STORAGE_KEY,
    GIT_CHANGES_DEFAULT_RATIO,
    containerHeightPx,
  );
}

export function writeGitChangesPaneRatio(
  ratio: number,
  containerHeightPx?: number,
): void {
  writeStoredRatio(GIT_CHANGES_PANE_RATIO_STORAGE_KEY, ratio, containerHeightPx);
}

const WORKSPACE_SIDEBAR_EXPANDED_STORAGE_KEY =
  "spirit-desktop-workspace-sidebar-expanded-by-id";

const WORKSPACE_SIDEBAR_EXPANDED_MAX_ENTRIES = 200;

/** `false` = 收起；缺省或 `true` = 展开（与 SessionSidebar Collapsible 一致）。 */
export type WorkspaceSidebarExpandedById = Record<string, boolean>;

function sanitizeWorkspaceSidebarExpandedById(
  value: unknown,
): WorkspaceSidebarExpandedById {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record: WorkspaceSidebarExpandedById = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length === 0 || key.length > 512) {
      continue;
    }
    if (typeof entry === "boolean") {
      record[key] = entry;
    }
  }
  const keys = Object.keys(record);
  if (keys.length <= WORKSPACE_SIDEBAR_EXPANDED_MAX_ENTRIES) {
    return record;
  }
  const trimmed: WorkspaceSidebarExpandedById = {};
  for (const key of keys.slice(0, WORKSPACE_SIDEBAR_EXPANDED_MAX_ENTRIES)) {
    trimmed[key] = record[key]!;
  }
  return trimmed;
}

export function readWorkspaceSidebarExpandedById(): WorkspaceSidebarExpandedById {
  try {
    if (typeof localStorage === "undefined") {
      return {};
    }
    const raw = localStorage.getItem(WORKSPACE_SIDEBAR_EXPANDED_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return sanitizeWorkspaceSidebarExpandedById(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeWorkspaceSidebarExpandedById(
  value: WorkspaceSidebarExpandedById,
): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(
      WORKSPACE_SIDEBAR_EXPANDED_STORAGE_KEY,
      JSON.stringify(sanitizeWorkspaceSidebarExpandedById(value)),
    );
  } catch {
    // ignore
  }
}

const SIDEBAR_WORKSPACE_SECTION_EXPANDED_KEY =
  "spirit-desktop-sidebar-workspace-section-expanded";
const SIDEBAR_NO_WORKSPACE_SECTION_EXPANDED_KEY =
  "spirit-desktop-sidebar-no-workspace-section-expanded";

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === "undefined") {
      return fallback;
    }
    const raw = localStorage.getItem(key);
    if (raw === "false") {
      return false;
    }
    if (raw === "true") {
      return true;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}

export function readSidebarWorkspaceSectionExpanded(): boolean {
  return readStoredBoolean(SIDEBAR_WORKSPACE_SECTION_EXPANDED_KEY, true);
}

export function writeSidebarWorkspaceSectionExpanded(expanded: boolean): void {
  writeStoredBoolean(SIDEBAR_WORKSPACE_SECTION_EXPANDED_KEY, expanded);
}

export function readSidebarNoWorkspaceSectionExpanded(): boolean {
  return readStoredBoolean(SIDEBAR_NO_WORKSPACE_SECTION_EXPANDED_KEY, true);
}

export function writeSidebarNoWorkspaceSectionExpanded(expanded: boolean): void {
  writeStoredBoolean(SIDEBAR_NO_WORKSPACE_SECTION_EXPANDED_KEY, expanded);
}
