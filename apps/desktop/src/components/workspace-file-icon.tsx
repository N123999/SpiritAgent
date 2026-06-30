import { useTheme } from '@/hooks/useTheme';
import { workspaceFileBasename } from '@/lib/file-picker-path';
import {
  resolveWorkspaceFileIcon,
  type WorkspaceFileIconColorMode,
} from '@/lib/workspace-file-icon-resolver';
import { cn } from '@/lib/utils';
import type { WorkspaceExplorerEntryKind } from '@/types';

const DEFAULT_SIZE_PX = 14;

export type WorkspaceFileIconProps = {
  name?: string;
  path?: string;
  kind?: WorkspaceExplorerEntryKind;
  size?: number;
  className?: string;
  colorMode?: WorkspaceFileIconColorMode;
};

function injectSvgDimensions(svg: string, size: number): string {
  return svg.replace(
    /^<svg\b/u,
    `<svg width="${size}" height="${size}"`,
  );
}

export function WorkspaceFileIcon({
  name,
  path,
  kind = 'file',
  size = DEFAULT_SIZE_PX,
  className,
  colorMode = 'seti',
}: WorkspaceFileIconProps) {
  const { resolvedDark } = useTheme();
  const resolvedName = name ?? (path ? workspaceFileBasename(path) : '');
  const icon = resolveWorkspaceFileIcon(resolvedName, kind, {
    colorMode,
    theme: resolvedDark ? 'dark' : 'light',
  });

  if (!icon || !resolvedName) {
    return null;
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={icon.color ? { color: icon.color } : undefined}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: injectSvgDimensions(icon.svg, size) }}
    />
  );
}
