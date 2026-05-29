export const FONT_STORAGE_KEY = "spirit-agent-desktop-font" as const;
export const SPIRIT_UI_FONT_STACK_VAR = "--spirit-ui-font-stack" as const;
export const DEFAULT_FONT_ID = "geist" as const;
export const DEFAULT_FONT_LABEL = "Geist（默认）" as const;

export type FontPreference = typeof DEFAULT_FONT_ID | string;

export function getStoredFont(): FontPreference {
  if (typeof localStorage === "undefined") {
    return DEFAULT_FONT_ID;
  }
  const raw = localStorage.getItem(FONT_STORAGE_KEY)?.trim();
  return raw || DEFAULT_FONT_ID;
}

export function setStoredFont(pref: FontPreference): void {
  if (pref === DEFAULT_FONT_ID || !pref.trim()) {
    localStorage.removeItem(FONT_STORAGE_KEY);
    return;
  }
  localStorage.setItem(FONT_STORAGE_KEY, pref.trim());
}

export function applyFontToDocument(pref: FontPreference): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const normalized = pref.trim();
  if (!normalized || normalized === DEFAULT_FONT_ID) {
    root.style.removeProperty(SPIRIT_UI_FONT_STACK_VAR);
    return;
  }

  root.style.setProperty(SPIRIT_UI_FONT_STACK_VAR, toFontFamilyStack(normalized));
}

export function toFontFamilyStack(family: string): string {
  return `${quoteFontFamily(family)}, system-ui, sans-serif`;
}

function quoteFontFamily(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
