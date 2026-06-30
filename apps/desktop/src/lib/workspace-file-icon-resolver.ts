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
};

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
  return {
    svg: normalizeSetiSvgForCurrentColor(svg),
    color: colorMode === 'seti' ? color : undefined,
  };
}

/** 供测试或需要原始色板时读取当前主题 map。 */
export function setiFileIconThemeMap(theme: 'dark' | 'light'): SetiFileIconColorMap {
  return setiFileIconColorsForTheme(theme);
}
