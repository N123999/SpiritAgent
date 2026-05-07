import { useMemo } from 'react'

import { AtSign, File, Plus } from 'lucide-react'

import { ActionPopover, type ActionPopoverItem } from '@/components/ui/action-popover'

type ComposerInsertMenuProps = {
  disabled?: boolean
  canPickLocalFile?: boolean
  onInsertWorkspaceReference(): void
  onPickLocalFile(): void | Promise<void>
  onInsertSkillTrigger(): void
}

function SlashBadge() {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted/65 text-[10px] font-semibold text-muted-foreground">
      /
    </span>
  )
}

export function ComposerInsertMenu({
  disabled = false,
  canPickLocalFile = false,
  onInsertWorkspaceReference,
  onPickLocalFile,
  onInsertSkillTrigger,
}: ComposerInsertMenuProps) {
  const items = useMemo<readonly ActionPopoverItem[]>(
    () => [
      {
        id: 'workspace-file-reference',
        icon: <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
        label: '引用工作区文件',
        onSelect: onInsertWorkspaceReference,
      },
      {
        id: 'local-file-picker',
        icon: <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
        label: '选择本地文件',
        disabled: !canPickLocalFile,
        onSelect: onPickLocalFile,
      },
      {
        id: 'skill-trigger',
        icon: <SlashBadge />,
        label: '引用 Skill',
        onSelect: onInsertSkillTrigger,
      },
    ],
    [canPickLocalFile, onInsertSkillTrigger, onInsertWorkspaceReference, onPickLocalFile],
  )

  return (
    <ActionPopover
      ariaLabel="打开插入面板"
      title="插入"
      heading="插入"
      disabled={disabled}
      triggerIcon={<Plus className="size-3.5" aria-hidden />}
      items={items}
    />
  )
}
