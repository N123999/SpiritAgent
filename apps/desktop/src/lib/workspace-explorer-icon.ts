import { ListTodo, type LucideIcon } from 'lucide-react';

import { workspaceFileBasename } from '@/lib/file-picker-path';
import {
  resolveWorkspaceFileIcon,
  type ResolveWorkspaceFileIconOptions,
  type ResolvedWorkspaceFileIcon,
  type WorkspaceFileIconColorMode,
} from '@/lib/workspace-file-icon-resolver';
import type { WorkspaceExplorerEntryKind } from '@/types';

export {
  resolveWorkspaceFileIcon,
  setiFileIconThemeMap,
  type ResolveWorkspaceFileIconOptions,
  type ResolvedWorkspaceFileIcon,
  type WorkspaceFileIconColorMode,
} from '@/lib/workspace-file-icon-resolver';

export {
  SETI_FILE_ICON_COLORS_DARK,
  SETI_FILE_ICON_COLORS_LIGHT,
  setiFileIconColorsForTheme,
  type SetiFileIconColorKey,
  type SetiFileIconColorMap,
} from '@/lib/seti-file-icon-colors';

export { normalizeSetiSvgForCurrentColor } from '@/lib/workspace-file-icon-svg';

/** 文件工具 Tab：仅 Plan 用 Lucide；其余 Seti 字形由 WorkspaceFileIcon 渲染。 */
export function resolveWorkspaceFilesTabIcon(
  tabTitle: string | undefined,
): LucideIcon | undefined {
  const title = tabTitle?.trim();
  if (!title) {
    return undefined;
  }
  if (title === 'Plan') {
    return ListTodo;
  }
  return undefined;
}

export function resolveWorkspaceFileIconForPath(
  path: string,
  kind: WorkspaceExplorerEntryKind = 'file',
  options?: ResolveWorkspaceFileIconOptions,
): ResolvedWorkspaceFileIcon | null {
  return resolveWorkspaceFileIcon(workspaceFileBasename(path), kind, options);
}
