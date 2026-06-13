import { workspaceFileBasename } from '@/lib/file-picker-path'
import { workspaceExplorerIconForPath } from '@/lib/workspace-explorer-icon'
import { cn } from '@/lib/utils'

type WorkspaceFilePickerRowProps = {
  path: string
  tone?: 'popover' | 'menu'
}

export function WorkspaceFilePickerRow({ path, tone = 'popover' }: WorkspaceFilePickerRowProps) {
  const Icon = workspaceExplorerIconForPath(path)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span
        className={cn(
          'shrink-0 whitespace-nowrap text-sm font-medium leading-6',
          tone === 'menu' ? 'text-foreground' : 'text-popover-foreground',
        )}
      >
        {workspaceFileBasename(path)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
        {path}
      </span>
    </div>
  )
}
