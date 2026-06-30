import { themeIcons } from 'seti-icons';

import {
  setiFileIconColorsForTheme,
  type SetiFileIconColorMap,
} from '@/lib/seti-file-icon-colors';
import { normalizeSetiSvgForCurrentColor } from '@/lib/workspace-file-icon-svg';
import type { WorkspaceExplorerEntryKind } from '@/types';

export type WorkspaceFileIconColorMode = 'seti' | 'inherit';

export type ResolveWorkspaceFileIconOptions = {
  colorMode?: WorkspaceFileIconColorMode;
  theme?: 'dark' | 'light';
};

export type ResolvedWorkspaceFileIcon = {
  svg: string;
  color: string | undefined;
  /** 实心 glyph 与 default fallback 同 hex 时压暗，对齐 Cargo.lock 视觉亮度。 */
  opacity?: number;
};

/** Seti 对 .gitignore / .toml 等扩展名单独着色；此处对齐 default fallback 视觉（white + 固定 opacity）。 */
const SETI_ICON_FALLBACK_APPEARANCE_NAMES = new Set(['.gitignore', 'cargo.toml']);

/** 实心 glyph 使用 fallback white 时的统一 opacity。 */
export const SETI_FALLBACK_GLYPH_OPACITY = 0.5;

const getThemedIconDark = themeIcons(setiFileIconColorsForTheme('dark'));
const getThemedIconLight = themeIcons(setiFileIconColorsForTheme('light'));

function getThemedIcon(theme: 'dark' | 'light') {
  return theme === 'light' ? getThemedIconLight : getThemedIconDark;
}

function resolveLookupName(name: string, kind: WorkspaceExplorerEntryKind): string {
  const trimmed = name.trim();
  if (kind === 'dir') {
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
  return trimmed;
}

type SetiIconAppearance = {
  color: string;
  opacity?: number;
};

function resolveSetiIconAppearance(
  lookupName: string,
  color: string,
  theme: 'dark' | 'light',
): SetiIconAppearance {
  const basename = lookupName.replace(/\/$/, '').split(/[/\\]/).pop() ?? lookupName;
  const matchFallbackAppearance = SETI_ICON_FALLBACK_APPEARANCE_NAMES.has(basename.toLowerCase());
  if (!matchFallbackAppearance) {
    return { color };
  }
  return {
    color: setiFileIconColorsForTheme(theme).white,
    opacity: SETI_FALLBACK_GLYPH_OPACITY,
  };
}

export function resolveWorkspaceFileIcon(
  name: string,
  kind: WorkspaceExplorerEntryKind = 'file',
  options: ResolveWorkspaceFileIconOptions = {},
): ResolvedWorkspaceFileIcon | null {
  const { colorMode = 'seti', theme = 'dark' } = options;
  const lookupName = resolveLookupName(name, kind);
  if (!lookupName) {
    return null;
  }

  const { svg, color } = getThemedIcon(theme)(lookupName);
  const normalizedSvg = normalizeSetiSvgForCurrentColor(svg);
  const appearance =
    colorMode === 'seti'
      ? resolveSetiIconAppearance(lookupName, color, theme)
      : null;
  return {
    svg: normalizedSvg,
    color: appearance?.color,
    opacity: appearance?.opacity,
  };
}

/** 供测试或需要原始色板时读取当前主题 map。 */
export function setiFileIconThemeMap(theme: 'dark' | 'light'): SetiFileIconColorMap {
  return setiFileIconColorsForTheme(theme);
}
