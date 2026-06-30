import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Folder } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { WorkspaceFileIconColorMode } from '@/lib/workspace-file-icon-resolver';

/** 与 slash / @ 下拉 Lucide 图标一致（见 skill-slash-menu）。 */
export const WORKSPACE_DIRECTORY_LIST_ICON_CLASS = 'size-3.5 shrink-0 opacity-70';

/** Chip inherit 目录图标，与 main 及其它 composer chip 一致（10px）。 */
export const WORKSPACE_DIRECTORY_CHIP_ICON_CLASS = 'size-[10px] shrink-0';

/** seti-icons 无 folder glyph；目录用 Lucide Folder，不着色、尺寸对齐下拉菜单。 */
export function workspaceDirectoryIconClassName(
  colorMode: WorkspaceFileIconColorMode,
  className?: string,
): string {
  if (colorMode === 'inherit') {
    return cn(WORKSPACE_DIRECTORY_CHIP_ICON_CLASS, className);
  }
  return cn(WORKSPACE_DIRECTORY_LIST_ICON_CLASS, className);
}

export function renderWorkspaceDirectoryIconMarkup(
  className: string,
  colorMode: WorkspaceFileIconColorMode,
): string {
  return renderToStaticMarkup(
    createElement(Folder, {
      className: workspaceDirectoryIconClassName(colorMode, className),
      'aria-hidden': true,
    }),
  ).trim();
}
