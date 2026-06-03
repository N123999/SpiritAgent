import * as monaco from 'monaco-editor';

export const SPIRIT_MONACO_DARK = 'spirit-desktop-dark';
export const SPIRIT_MONACO_TOOL_CALL_DIFF = 'spirit-desktop-tool-call-diff';

const FALLBACK_DARK_BG = '#252525';
const FALLBACK_LIGHT_BG = '#ffffff';
const MONACO_DARK_EDITOR_SURFACE = '#151515';
const FALLBACK_DARK_FG = '#fafafa';
const FALLBACK_MUTED_FG = '#a0a0a0';

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbaToMonacoHex(r: number, g: number, b: number, a: number): string {
  const R = clampByte(r).toString(16).padStart(2, '0');
  const G = clampByte(g).toString(16).padStart(2, '0');
  const B = clampByte(b).toString(16).padStart(2, '0');
  if (a >= 0.998) {
    return `#${R}${G}${B}`;
  }
  const A = clampByte(a * 255).toString(16).padStart(2, '0');
  return `#${R}${G}${B}${A}`;
}

function normalizeColorForMonaco(cssColor: string, fallbackHex: string): string {
  const raw = cssColor.trim();
  const candidates = [raw, fallbackHex].filter(
    (c) => c.length > 0 && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)',
  );
  const cvs = document.createElement('canvas');
  cvs.width = 1;
  cvs.height = 1;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return fallbackHex.startsWith('#') ? fallbackHex : FALLBACK_DARK_BG;
  }
  for (const c of candidates) {
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) {
        continue;
      }
      return rgbaToMonacoHex(d[0], d[1], d[2], d[3] / 255);
    } catch {
      /* skip */
    }
  }
  return fallbackHex.startsWith('#') ? fallbackHex : FALLBACK_DARK_BG;
}

function resolveCssBackground(expression: string, fallback: string): string {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;background:${expression};`;
  document.documentElement.appendChild(el);
  const resolved = getComputedStyle(el).backgroundColor;
  document.documentElement.removeChild(el);
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') {
    return normalizeColorForMonaco(fallback, fallback);
  }
  return normalizeColorForMonaco(resolved, fallback);
}

function resolveCssColor(expression: string, fallback: string): string {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;color:${expression};`;
  document.documentElement.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.documentElement.removeChild(el);
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') {
    return normalizeColorForMonaco(fallback, fallback);
  }
  return normalizeColorForMonaco(resolved, fallback);
}

/** 工具卡 Diff：低饱和、低透明度，接近 Cursor / GitHub 的淡色块风格。 */
function resolveDiffEditorColors(subtle: boolean, isDark: boolean): {
  insertedLine: string;
  removedLine: string;
  insertedText: string;
  removedText: string;
} {
  if (!subtle) {
    return {
      insertedLine: resolveCssBackground(
        'color-mix(in oklab, #22c55e 22%, transparent)',
        'rgba(34, 197, 94, 0.18)',
      ),
      removedLine: resolveCssBackground(
        'color-mix(in oklab, #ef4444 22%, transparent)',
        'rgba(239, 68, 68, 0.18)',
      ),
      insertedText: resolveCssBackground(
        'color-mix(in oklab, #22c55e 35%, transparent)',
        'rgba(34, 197, 94, 0.28)',
      ),
      removedText: resolveCssBackground(
        'color-mix(in oklab, #ef4444 35%, transparent)',
        'rgba(239, 68, 68, 0.28)',
      ),
    };
  }

  const lineMix = isDark ? 7 : 9;
  const textMix = isDark ? 11 : 13;
  const add = '#6ee7b7';
  const remove = '#fca5a5';

  return {
    insertedLine: resolveCssBackground(
      `color-mix(in oklab, ${add} ${lineMix}%, transparent)`,
      isDark ? 'rgba(110, 231, 183, 0.055)' : 'rgba(110, 231, 183, 0.09)',
    ),
    removedLine: resolveCssBackground(
      `color-mix(in oklab, ${remove} ${lineMix}%, transparent)`,
      isDark ? 'rgba(252, 165, 165, 0.055)' : 'rgba(252, 165, 165, 0.09)',
    ),
    insertedText: resolveCssBackground(
      `color-mix(in oklab, ${add} ${textMix}%, transparent)`,
      isDark ? 'rgba(110, 231, 183, 0.085)' : 'rgba(110, 231, 183, 0.12)',
    ),
    removedText: resolveCssBackground(
      `color-mix(in oklab, ${remove} ${textMix}%, transparent)`,
      isDark ? 'rgba(252, 165, 165, 0.085)' : 'rgba(252, 165, 165, 0.12)',
    ),
  };
}

function defineSpiritDesktopMonacoTheme(
  themeId: string,
  base: 'vs' | 'vs-dark',
  editorSurface: string,
  options?: { subtleDiff?: boolean },
): void {
  const isDark = base === 'vs-dark';
  const fg = resolveCssColor('var(--foreground)', isDark ? FALLBACK_DARK_FG : '#0a0a0a');
  const mutedFg = resolveCssColor('var(--muted-foreground)', isDark ? FALLBACK_MUTED_FG : '#737373');
  const lineHighlight = resolveCssBackground(
    `color-mix(in oklab, var(--foreground) 8%, ${editorSurface})`,
    editorSurface,
  );
  const selection = resolveCssBackground(
    'color-mix(in oklab, var(--accent) 50%, transparent)',
    'rgba(100, 100, 100, 0.35)',
  );
  const inactiveSelection = resolveCssBackground(
    'color-mix(in oklab, var(--accent) 28%, transparent)',
    'rgba(100, 100, 100, 0.2)',
  );
  const widgetBg = resolveCssBackground('var(--popover)', editorSurface);
  const border = resolveCssBackground('var(--border)', 'rgba(128, 128, 128, 0.2)');
  const diffColors = resolveDiffEditorColors(options?.subtleDiff ?? false, isDark);

  try {
    monaco.editor.defineTheme(themeId, {
      base,
      inherit: true,
      rules: [],
      colors: {
        'editor.background': editorSurface,
        'editor.foreground': fg,
        'editorGutter.background': editorSurface,
        'editorLineNumber.foreground': mutedFg,
        'editorLineNumber.activeForeground': fg,
        'editor.lineHighlightBackground': lineHighlight,
        'editor.selectionBackground': selection,
        'editor.inactiveSelectionBackground': inactiveSelection,
        'editorCursor.foreground': fg,
        'editorWidget.background': widgetBg,
        'editorWidget.border': border,
        'diffEditor.insertedLineBackground': diffColors.insertedLine,
        'diffEditor.removedLineBackground': diffColors.removedLine,
        'diffEditor.insertedTextBackground': diffColors.insertedText,
        'diffEditor.removedTextBackground': diffColors.removedText,
        'scrollbarSlider.background': resolveCssBackground(
          'color-mix(in oklab, var(--foreground) 18%, transparent)',
          'rgba(121, 121, 121, 0.4)',
        ),
        'scrollbarSlider.hoverBackground': resolveCssBackground(
          'color-mix(in oklab, var(--foreground) 28%, transparent)',
          'rgba(100, 100, 100, 0.7)',
        ),
        'scrollbarSlider.activeBackground': resolveCssBackground(
          'color-mix(in oklab, var(--foreground) 35%, transparent)',
          'rgba(191, 191, 191, 0.4)',
        ),
      },
    });
  } catch {
    monaco.editor.defineTheme(themeId, {
      base,
      inherit: true,
      rules: [],
      colors: {},
    });
  }
}

/** 深色下 Workspace 编辑区固定深灰底，与侧栏分界。 */
export function registerSpiritDesktopDarkMonacoTheme(): void {
  defineSpiritDesktopMonacoTheme(SPIRIT_MONACO_DARK, 'vs-dark', MONACO_DARK_EDITOR_SURFACE);
}

/** 工具卡内联 Diff：画布与 `var(--background)` 一致。 */
export function registerSpiritDesktopToolCallDiffMonacoTheme(): void {
  const isDark = document.documentElement.classList.contains('dark');
  const appSurface = resolveCssBackground(
    'var(--background)',
    isDark ? FALLBACK_DARK_BG : FALLBACK_LIGHT_BG,
  );
  defineSpiritDesktopMonacoTheme(
    SPIRIT_MONACO_TOOL_CALL_DIFF,
    isDark ? 'vs-dark' : 'vs',
    appSurface,
    { subtleDiff: true },
  );
}

export function syncMonacoThemeFromDocument(): void {
  const isDark = document.documentElement.classList.contains('dark');
  if (!isDark) {
    monaco.editor.setTheme('vs');
    return;
  }
  registerSpiritDesktopDarkMonacoTheme();
  monaco.editor.setTheme(SPIRIT_MONACO_DARK);
}

export function syncMonacoThemeForToolCallDiff(): void {
  registerSpiritDesktopToolCallDiffMonacoTheme();
  monaco.editor.setTheme(SPIRIT_MONACO_TOOL_CALL_DIFF);
}
