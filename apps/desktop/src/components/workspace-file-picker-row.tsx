import {
  isWorkspaceReferenceDirectoryPath,
  normalizeWorkspaceReferenceDirectoryPath,
} from '@spirit-agent/host-internal/workspace-file-reference-query'
import {
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from '@/lib/desktop-chrome'
import { workspaceFileBasename } from '@/lib/file-picker-path'
import { workspaceExplorerIconForPath } from '@/lib/workspace-explorer-icon'
import { cn } from '@/lib/utils'

type WorkspaceFilePickerRowProps = {
  path: string
  tone?: 'popover' | 'menu'
  layout?: 'inline' | 'stacked'
}

export function WorkspaceFilePickerRow({
  path,
  tone = 'popover',
  layout = 'inline',
}: WorkspaceFilePickerRowProps) {
  const isDirectory = isWorkspaceReferenceDirectoryPath(path)
  const displayPath = isDirectory ? normalizeWorkspaceReferenceDirectoryPath(path) : path
  const Icon = workspaceExplorerIconForPath(displayPath, isDirectory ? 'dir' : 'file')
  const basename = workspaceFileBasename(displayPath)

  if (layout === 'stacked') {
    return (
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={basename}>
            {basename}
          </div>
          <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={displayPath}>
            {displayPath}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span
        className={cn(
          'shrink-0 whitespace-nowrap text-sm font-medium leading-6',
          tone === 'menu' ? 'text-foreground' : 'text-popover-foreground',
        )}
      >
        {basename}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
        {displayPath}
      </span>
    </div>
  )
}
