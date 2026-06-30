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
const WORKSPACE_TOOLS_WIDTH_RATIO_STORAGE_KEY = "spirit-desktop-workspace-tools-width-ratio";

export const WORKSPACE_TOOLS_MIN_WIDTH_PX = 240;
export const WORKSPACE_TOOLS_DEFAULT_WIDTH_PX = 420;
export const WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO = 0.62;
export const WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO =
  WORKSPACE_TOOLS_DEFAULT_WIDTH_PX / 1200;

export function computeWorkspaceToolsMaxWidthPx(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  return Math.round(viewportWidthPx * WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO);
}

function clampWorkspaceToolsWidthRatio(
  ratio: number,
  viewportWidthPx: number,
): number {
  const min =
    viewportWidthPx > 0
      ? WORKSPACE_TOOLS_MIN_WIDTH_PX / viewportWidthPx
      : WORKSPACE_TOOLS_MIN_WIDTH_PX / 1200;
  return Math.min(
    WORKSPACE_TOOLS_VIEWPORT_MAX_WIDTH_RATIO,
    Math.max(min, ratio),
  );
}

function readStoredWorkspaceToolsWidthRatio(
  viewportWidthPx: number,
): number | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const raw = localStorage.getItem(WORKSPACE_TOOLS_WIDTH_RATIO_STORAGE_KEY);
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return clampWorkspaceToolsWidthRatio(parsed, viewportWidthPx);
    }
  } catch {
    // ignore
  }
  return null;
}

function writeStoredWorkspaceToolsWidthRatio(
  ratio: number,
  viewportWidthPx: number,
): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(
      WORKSPACE_TOOLS_WIDTH_RATIO_STORAGE_KEY,
      String(clampWorkspaceToolsWidthRatio(ratio, viewportWidthPx)),
    );
  } catch {
    // ignore
  }
}

export function readWorkspaceToolsWidthRatio(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  const storedRatio = readStoredWorkspaceToolsWidthRatio(viewportWidthPx);
  if (storedRatio !== null) {
    return storedRatio;
  }

  try {
    if (typeof localStorage === "undefined") {
      return clampWorkspaceToolsWidthRatio(
        WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO,
        viewportWidthPx,
      );
    }
    const legacyRaw = localStorage.getItem(WORKSPACE_TOOLS_WIDTH_STORAGE_KEY);
    if (legacyRaw === null) {
      return clampWorkspaceToolsWidthRatio(
        WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO,
        viewportWidthPx,
      );
    }
    const legacyMax = computeWorkspaceToolsMaxWidthPx(viewportWidthPx);
    const legacyPx = readStoredPositiveInt(
      WORKSPACE_TOOLS_WIDTH_STORAGE_KEY,
      WORKSPACE_TOOLS_DEFAULT_WIDTH_PX,
      WORKSPACE_TOOLS_MIN_WIDTH_PX,
      legacyMax,
    );
    const migratedRatio = clampWorkspaceToolsWidthRatio(
      legacyPx / viewportWidthPx,
      viewportWidthPx,
    );
    writeStoredWorkspaceToolsWidthRatio(migratedRatio, viewportWidthPx);
    return migratedRatio;
  } catch {
    return clampWorkspaceToolsWidthRatio(
      WORKSPACE_TOOLS_DEFAULT_WIDTH_RATIO,
      viewportWidthPx,
    );
  }
}

export function writeWorkspaceToolsWidthRatio(
  ratio: number,
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): void {
  writeStoredWorkspaceToolsWidthRatio(ratio, viewportWidthPx);
}

export function readWorkspaceToolsWidthPx(
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): number {
  const ratio = readWorkspaceToolsWidthRatio(viewportWidthPx);
  const max = computeWorkspaceToolsMaxWidthPx(viewportWidthPx);
  return clampInt(
    Math.round(viewportWidthPx * ratio),
    WORKSPACE_TOOLS_MIN_WIDTH_PX,
    max,
  );
}

export function writeWorkspaceToolsWidthPx(
  widthPx: number,
  viewportWidthPx = typeof window !== "undefined" ? window.innerWidth : 1200,
): void {
  if (viewportWidthPx <= 0) {
    return;
  }
  writeWorkspaceToolsWidthRatio(widthPx / viewportWidthPx, viewportWidthPx);
}

const PR_CHANGES_TREE_WIDTH_STORAGE_KEY = "spirit-desktop-pr-changes-tree-width-px";

export const PR_CHANGES_TREE_MIN_WIDTH_PX = 144;
export const PR_CHANGES_TREE_DEFAULT_WIDTH_PX = 208;
const PR_CHANGES_TREE_MAX_WIDTH_RATIO = 0.45;

export function computePrChangesTreeMaxWidthPx(containerWidthPx: number): number {
  return Math.round(containerWidthPx * PR_CHANGES_TREE_MAX_WIDTH_RATIO);
}

function clampPrChangesTreeWidthPx(widthPx: number, containerWidthPx?: number): number {
  const max =
    containerWidthPx && containerWidthPx > 0
      ? computePrChangesTreeMaxWidthPx(containerWidthPx)
      : computePrChangesTreeMaxWidthPx(1200);
  return clampInt(widthPx, PR_CHANGES_TREE_MIN_WIDTH_PX, max);
}

export function readPrChangesTreeWidthPx(containerWidthPx?: number): number {
  const max =
    containerWidthPx && containerWidthPx > 0
      ? computePrChangesTreeMaxWidthPx(containerWidthPx)
      : computePrChangesTreeMaxWidthPx(1200);
  return readStoredPositiveInt(
    PR_CHANGES_TREE_WIDTH_STORAGE_KEY,
    PR_CHANGES_TREE_DEFAULT_WIDTH_PX,
    PR_CHANGES_TREE_MIN_WIDTH_PX,
    max,
  );
}

export function writePrChangesTreeWidthPx(widthPx: number, containerWidthPx?: number): void {
  writeStoredPositiveInt(
    PR_CHANGES_TREE_WIDTH_STORAGE_KEY,
    clampPrChangesTreeWidthPx(widthPx, containerWidthPx),
  );
}

const WORKSPACE_FILES_TREE_WIDTH_STORAGE_KEY = "spirit-desktop-workspace-files-tree-width-px";

export const WORKSPACE_FILES_TREE_MIN_WIDTH_PX = 120;
/** 与原先 `min(40%, 13rem)` 上限一致 */
export const WORKSPACE_FILES_TREE_DEFAULT_WIDTH_PX = 208;
const WORKSPACE_FILES_TREE_MAX_WIDTH_RATIO = 0.45;

export function computeWorkspaceFilesTreeMaxWidthPx(containerWidthPx: number): number {
  return Math.round(containerWidthPx * WORKSPACE_FILES_TREE_MAX_WIDTH_RATIO);
}

function clampWorkspaceFilesTreeWidthPx(widthPx: number, containerWidthPx?: number): number {
  const max =
    containerWidthPx && containerWidthPx > 0
      ? computeWorkspaceFilesTreeMaxWidthPx(containerWidthPx)
      : computeWorkspaceFilesTreeMaxWidthPx(1200);
  return clampInt(widthPx, WORKSPACE_FILES_TREE_MIN_WIDTH_PX, max);
}

export function readWorkspaceFilesTreeWidthPx(containerWidthPx?: number): number {
  const max =
    containerWidthPx && containerWidthPx > 0
      ? computeWorkspaceFilesTreeMaxWidthPx(containerWidthPx)
      : computeWorkspaceFilesTreeMaxWidthPx(1200);
  return readStoredPositiveInt(
    WORKSPACE_FILES_TREE_WIDTH_STORAGE_KEY,
    WORKSPACE_FILES_TREE_DEFAULT_WIDTH_PX,
    WORKSPACE_FILES_TREE_MIN_WIDTH_PX,
    max,
  );
}

export function writeWorkspaceFilesTreeWidthPx(
  widthPx: number,
  containerWidthPx?: number,
): void {
  writeStoredPositiveInt(
    WORKSPACE_FILES_TREE_WIDTH_STORAGE_KEY,
    clampWorkspaceFilesTreeWidthPx(widthPx, containerWidthPx),
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

const PR_OVERVIEW_PANE_RATIO_STORAGE_KEY = "spirit-desktop-pr-overview-pane-ratio";

export const PR_OVERVIEW_DEFAULT_RATIO = 0.38;
const PR_OVERVIEW_RATIO_LOOSE_MIN = 0.15;
const PR_OVERVIEW_RATIO_LOOSE_MAX = 0.75;

export const PR_OVERVIEW_MIN_PX = 96;
export const PR_TABS_SECTION_MIN_PX = 180;
export const PR_OVERVIEW_SPLITTER_PX = 4;

export function computePrOverviewPaneRatioBounds(containerHeightPx: number): {
  min: number;
  max: number;
} {
  const min = PR_OVERVIEW_MIN_PX / containerHeightPx;
  const max =
    (containerHeightPx - PR_TABS_SECTION_MIN_PX - PR_OVERVIEW_SPLITTER_PX) / containerHeightPx;
  return { min, max };
}

export function clampPrOverviewPaneRatio(
  ratio: number,
  containerHeightPx?: number,
): number {
  if (containerHeightPx && containerHeightPx > 0) {
    const { min, max } = computePrOverviewPaneRatioBounds(containerHeightPx);
    if (min <= max) {
      return clampRatio(ratio, min, max);
    }
  }
  return clampRatio(ratio, PR_OVERVIEW_RATIO_LOOSE_MIN, PR_OVERVIEW_RATIO_LOOSE_MAX);
}

export function readPrOverviewPaneRatio(containerHeightPx?: number): number {
  try {
    if (typeof localStorage === "undefined") {
      return clampPrOverviewPaneRatio(PR_OVERVIEW_DEFAULT_RATIO, containerHeightPx);
    }
    const raw = localStorage.getItem(PR_OVERVIEW_PANE_RATIO_STORAGE_KEY);
    const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return clampPrOverviewPaneRatio(parsed, containerHeightPx);
    }
  } catch {
    // ignore
  }
  return clampPrOverviewPaneRatio(PR_OVERVIEW_DEFAULT_RATIO, containerHeightPx);
}

export function writePrOverviewPaneRatio(
  ratio: number,
  containerHeightPx?: number,
): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(
      PR_OVERVIEW_PANE_RATIO_STORAGE_KEY,
      String(clampPrOverviewPaneRatio(ratio, containerHeightPx)),
    );
  } catch {
    // ignore
  }
}

const WORKSPACE_SIDEBAR_EXPANDED_STORAGE_KEY =
  "spirit-desktop-workspace-sidebar-expanded-by-id";

const WORKSPACE_SIDEBAR_EXPANDED_MAX_ENTRIES = 200;

/** `false` = 收起；缺省或 `true` = 展开（与 SessionSidebar AnimatedCollapse 一致）。 */
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

const WORKSPACE_SIDEBAR_GROUP_ORDER_STORAGE_KEY =
  "spirit-desktop-workspace-sidebar-group-order";

const WORKSPACE_SIDEBAR_GROUP_ORDER_MAX_ENTRIES = 200;

function sanitizeWorkspaceSidebarGroupOrder(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const record: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 512) {
      continue;
    }
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    record.push(entry);
    if (record.length >= WORKSPACE_SIDEBAR_GROUP_ORDER_MAX_ENTRIES) {
      break;
    }
  }
  return record;
}

export function readWorkspaceSidebarGroupOrder(): string[] {
  try {
    if (typeof localStorage === "undefined") {
      return [];
    }
    const raw = localStorage.getItem(WORKSPACE_SIDEBAR_GROUP_ORDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return sanitizeWorkspaceSidebarGroupOrder(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeWorkspaceSidebarGroupOrder(ids: string[]): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(
      WORKSPACE_SIDEBAR_GROUP_ORDER_STORAGE_KEY,
      JSON.stringify(sanitizeWorkspaceSidebarGroupOrder(ids)),
    );
  } catch {
    // ignore
  }
}
