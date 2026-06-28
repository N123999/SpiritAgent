export const UI_LAYOUT_SCALE_STORAGE_KEY = "spirit-agent-desktop-ui-layout-scale" as const;
export const SPIRIT_UI_LAYOUT_SCALE_VAR = "--spirit-ui-layout-scale" as const;
export const UI_LAYOUT_SCALE_ROOT_ID = "spirit-ui-scale-root" as const;
export const UI_LAYOUT_SCALED_BODY_CLASS = "spirit-ui-layout-scaled" as const;
export const DEFAULT_UI_LAYOUT_SCALE = 1;
export const UI_LAYOUT_SCALE_MIN = 0.8;
export const UI_LAYOUT_SCALE_MAX = 1.25;
export const UI_LAYOUT_SCALE_STEP = 0.1;

export function clampUiLayoutScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return Math.min(UI_LAYOUT_SCALE_MAX, Math.max(UI_LAYOUT_SCALE_MIN, scale));
}

export function normalizeUiLayoutScale(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  const parsed = typeof raw === "number" ? raw : Number.parseFloat(String(raw).trim());
  if (!Number.isFinite(parsed)) {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return clampUiLayoutScale(parsed);
}

export function getStoredUiLayoutScale(): number {
  if (typeof localStorage === "undefined") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  return normalizeUiLayoutScale(localStorage.getItem(UI_LAYOUT_SCALE_STORAGE_KEY));
}

export function setStoredUiLayoutScale(scale: number): void {
  const normalized = clampUiLayoutScale(scale);
  if (normalized === DEFAULT_UI_LAYOUT_SCALE) {
    localStorage.removeItem(UI_LAYOUT_SCALE_STORAGE_KEY);
    return;
  }
  localStorage.setItem(UI_LAYOUT_SCALE_STORAGE_KEY, String(normalized));
}

function shouldApplyWin32TitleBarCounterZoom(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const electron =
    Boolean(window.spiritDesktop) || /\bElectron\//.test(navigator.userAgent);
  if (!electron) {
    return false;
  }
  // 与 isWin32ElectronShell 对齐：preload platform 优先，否则 UA 回退
  return window.spiritDesktop?.platform === "win32" || /Windows/i.test(navigator.userAgent);
}

function getScaleRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.getElementById(UI_LAYOUT_SCALE_ROOT_ID);
}

/** Radix 浮层须挂入与主 UI 相同的缩放根，避免 body transform 导致 fixed 定位偏移。 */
export function getUiLayoutPortalContainer(): HTMLElement | undefined {
  return getScaleRoot() ?? undefined;
}

export function getCurrentUiLayoutScale(): number {
  if (typeof document === "undefined") {
    return DEFAULT_UI_LAYOUT_SCALE;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(SPIRIT_UI_LAYOUT_SCALE_VAR)
    .trim();
  const parsed = raw ? Number.parseFloat(raw) : DEFAULT_UI_LAYOUT_SCALE;
  return Number.isFinite(parsed) ? parsed : DEFAULT_UI_LAYOUT_SCALE;
}

/** 缩放根是否带 transform（`.spirit-ui-layout-scaled`）；无 transform 时其内 fixed 走视口坐标。 */
export function isUiLayoutScaleTransformActive(): boolean {
  const scaleRoot = getScaleRoot();
  if (!scaleRoot) {
    return false;
  }
  return scaleRoot.classList.contains(UI_LAYOUT_SCALED_BODY_CLASS);
}

/** 视口坐标 → 缩放根内 position:fixed 本地坐标（仅 transform 激活时需换算）。 */
export function viewportPointToScaleRootLocal(
  viewportTop: number,
  viewportLeft: number,
): { top: number; left: number } {
  const scaleRoot = getScaleRoot();
  const isScaled = isUiLayoutScaleTransformActive();
  if (!scaleRoot || !isScaled) {
    return { top: viewportTop, left: viewportLeft };
  }
  const scale = getCurrentUiLayoutScale();
  const scaleRootRect = scaleRoot.getBoundingClientRect();
  return {
    top: (viewportTop - scaleRootRect.top) / scale,
    left: (viewportLeft - scaleRootRect.left) / scale,
  };
}

export type ViewportBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** 视口矩形 → 缩放根内 fixed 锚点盒（自定义 Radix trigger 须与 tooltip 同源换算）。 */
export function viewportRectToScaleRootLocal(rect: ViewportBox): ViewportBox {
  if (!isUiLayoutScaleTransformActive()) {
    return rect;
  }
  const scale = getCurrentUiLayoutScale();
  const { top, left } = viewportPointToScaleRootLocal(rect.top, rect.left);
  return {
    left,
    top,
    width: Math.max(rect.width / scale, 1),
    height: Math.max(rect.height / scale, 1),
  };
}

/** 同一缩放根内 getBoundingClientRect 差值 / 边长 → 本地 CSS 长度（shell 分割线定位用）。 */
export function viewportLengthToScaleRootLocal(length: number): number {
  if (!isUiLayoutScaleTransformActive()) {
    return length;
  }
  return length / getCurrentUiLayoutScale();
}

function syncWin32ChromeClass(root: HTMLElement): void {
  root.classList.toggle("spirit-desktop-win32", shouldApplyWin32TitleBarCounterZoom());
}

export function applyUiLayoutScaleToDocument(scale: number): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = clampUiLayoutScale(scale);
  const root = document.documentElement;
  const scaleRoot = getScaleRoot();

  syncWin32ChromeClass(root);

  if (!scaleRoot) {
    return;
  }

  if (normalized === DEFAULT_UI_LAYOUT_SCALE) {
    root.style.removeProperty(SPIRIT_UI_LAYOUT_SCALE_VAR);
    scaleRoot.classList.remove(UI_LAYOUT_SCALED_BODY_CLASS);
    return;
  }

  root.style.setProperty(SPIRIT_UI_LAYOUT_SCALE_VAR, String(normalized));
  scaleRoot.classList.add(UI_LAYOUT_SCALED_BODY_CLASS);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("resize"));
  }
}

export function stepUiLayoutScale(current: number, direction: "in" | "out"): number {
  const base = clampUiLayoutScale(current);
  const stepped =
    direction === "in"
      ? base + UI_LAYOUT_SCALE_STEP
      : base - UI_LAYOUT_SCALE_STEP;
  return clampUiLayoutScale(stepped);
}

export function formatUiLayoutScalePercent(scale: number): string {
  return `${Math.round(clampUiLayoutScale(scale) * 100)}%`;
}

export function resolveUiLayoutZoomShortcutAction(input: {
  defaultPrevented: boolean;
  modPressed: boolean;
  altKey: boolean;
  key: string;
}): "in" | "out" | "reset" | null {
  if (input.defaultPrevented || !input.modPressed || input.altKey) {
    return null;
  }

  const key = input.key;
  if (key === "=" || key === "+") {
    return "in";
  }
  if (key === "-" || key === "_") {
    return "out";
  }
  if (key === "0") {
    return "reset";
  }
  return null;
}
