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
    <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_minmax(0,68%)] items-center gap-2 overflow-hidden">
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <div
        className={cn(
          'min-w-0 truncate text-sm font-medium leading-6',
          tone === 'menu' ? 'text-foreground' : 'text-popover-foreground',
        )}
      >
        {workspaceFileBasename(path)}
      </div>
      <div className="min-w-0 truncate text-right text-xs leading-5 text-muted-foreground">
        {path}
      </div>
    </div>
  )
}
