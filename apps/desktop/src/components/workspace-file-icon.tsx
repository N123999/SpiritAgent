import { Folder } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';
import { workspaceFileBasename } from '@/lib/file-picker-path';
import { workspaceDirectoryIconClassName } from '@/lib/workspace-directory-icon';
import {
  resolveWorkspaceFileIcon,
  type WorkspaceFileIconColorMode,
} from '@/lib/workspace-file-icon-resolver';
import {
  prepareSetiSvgForDisplay,
  WORKSPACE_FILE_ICON_LIST_SIZE_PX,
} from '@/lib/workspace-file-icon-svg';
import { cn } from '@/lib/utils';
import type { WorkspaceExplorerEntryKind } from '@/types';

export type WorkspaceFileIconProps = {
  name?: string;
  path?: string;
  kind?: WorkspaceExplorerEntryKind;
  size?: number;
  className?: string;
  colorMode?: WorkspaceFileIconColorMode;
};

export function WorkspaceFileIcon({
  name,
  path,
  kind = 'file',
  size = WORKSPACE_FILE_ICON_LIST_SIZE_PX,
  className,
  colorMode = 'seti',
}: WorkspaceFileIconProps) {
  const { resolvedDark } = useTheme();
  const resolvedName = name ?? (path ? workspaceFileBasename(path) : '');
  if (!resolvedName) {
    return null;
  }

  const theme = resolvedDark ? 'dark' : 'light';

  if (kind === 'dir') {
    return (
      <Folder
        className={workspaceDirectoryIconClassName(colorMode, className)}
        aria-hidden
      />
    );
  }

  const icon = resolveWorkspaceFileIcon(resolvedName, kind, {
    colorMode,
    theme,
  });

  if (!icon) {
    return null;
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{
        width: size,
        height: size,
        ...(icon.color ? { color: icon.color } : undefined),
        ...(icon.opacity !== undefined ? { opacity: icon.opacity } : undefined),
      }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: prepareSetiSvgForDisplay(icon.svg, size) }}
    />
  );
}
