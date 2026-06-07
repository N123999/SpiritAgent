import { File } from 'lucide-react'

import { workspaceFileBasename } from '@/lib/file-picker-path'

type WorkspaceFilePickerRowProps = {
  path: string
}

export function WorkspaceFilePickerRow({ path }: WorkspaceFilePickerRowProps) {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_minmax(0,68%)] items-baseline gap-2 overflow-hidden">
      <File className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden />
      <div className="min-w-0 truncate text-sm font-medium leading-6 text-popover-foreground">
        {workspaceFileBasename(path)}
      </div>
      <div className="min-w-0 truncate text-right text-xs leading-5 text-muted-foreground">
        {path}
      </div>
    </div>
  )
}
