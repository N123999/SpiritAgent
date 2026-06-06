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