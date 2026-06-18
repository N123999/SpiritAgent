import * as monaco from 'monaco-editor';

export const SPIRIT_MONACO_DARK = 'spirit-desktop-dark';

const FALLBACK_DARK_BG = '#000000';
const FALLBACK_DARK_FG = '#fafafa';
const FALLBACK_MUTED_FG = '#a0a0a0';
const TRANSPARENT_MONACO_COLOR = '#00000000';

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

function isNativeMicaBackdropActive(): boolean {
  return document.documentElement.classList.contains('spirit-desktop-mica');
}

/** 深色下 Workspace 编辑区与 Void Theme 主背景一致（--background）；Mica 下透明以免叠深。 */
export function registerSpiritDesktopDarkMonacoTheme(): void {
  const editorSurface = isNativeMicaBackdropActive()
    ? TRANSPARENT_MONACO_COLOR
    : resolveCssBackground('var(--background)', FALLBACK_DARK_BG);
  const fg = resolveCssColor('var(--foreground)', FALLBACK_DARK_FG);
  const mutedFg = resolveCssColor('var(--muted-foreground)', FALLBACK_MUTED_FG);
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

  try {
    monaco.editor.defineTheme(SPIRIT_MONACO_DARK, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': editorSurface,
        'editor.foreground': fg,
        'editorGutter.background': editorSurface,
        'focusBorder': TRANSPARENT_MONACO_COLOR,
        'contrastBorder': TRANSPARENT_MONACO_COLOR,
        'editorLineNumber.foreground': mutedFg,
        'editorLineNumber.activeForeground': fg,
        'editor.lineHighlightBackground': lineHighlight,
        'editor.selectionBackground': selection,
        'editor.inactiveSelectionBackground': inactiveSelection,
        'editorCursor.foreground': fg,
        'editorWidget.background': widgetBg,
        'editorWidget.border': border,
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
    monaco.editor.defineTheme(SPIRIT_MONACO_DARK, {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {},
    });
  }
}

export const SPIRIT_MONACO_LIGHT = 'spirit-desktop-light';

/** 浅色 + Mica：编辑区透明，由外层面板 tint 着色。 */
export function registerSpiritDesktopLightMonacoTheme(): void {
  const editorSurface = isNativeMicaBackdropActive()
    ? TRANSPARENT_MONACO_COLOR
    : resolveCssBackground('var(--background)', '#ffffff');
  const fg = resolveCssColor('var(--foreground)', '#0a0a0a');
  const mutedFg = resolveCssColor('var(--muted-foreground)', '#737373');

  try {
    monaco.editor.defineTheme(SPIRIT_MONACO_LIGHT, {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': editorSurface,
        'editor.foreground': fg,
        'editorGutter.background': editorSurface,
        'focusBorder': TRANSPARENT_MONACO_COLOR,
        'contrastBorder': TRANSPARENT_MONACO_COLOR,
        'editorLineNumber.foreground': mutedFg,
        'editorLineNumber.activeForeground': fg,
      },
    });
  } catch {
    monaco.editor.defineTheme(SPIRIT_MONACO_LIGHT, {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {},
    });
  }
}

export function syncMonacoThemeFromDocument(): void {
  const isDark = document.documentElement.classList.contains('dark');
  const mica = isNativeMicaBackdropActive();
  if (!isDark) {
    if (mica) {
      registerSpiritDesktopLightMonacoTheme();
      monaco.editor.setTheme(SPIRIT_MONACO_LIGHT);
    } else {
      monaco.editor.setTheme('vs');
    }
    return;
  }
  registerSpiritDesktopDarkMonacoTheme();
  monaco.editor.setTheme(SPIRIT_MONACO_DARK);
}
