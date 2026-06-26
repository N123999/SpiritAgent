import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AtSign, File, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  instantHoverMotionClass,
} from '@/lib/desktop-chrome'
import { cn } from '@/lib/utils'

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
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const suppressTooltip = menuOpen || disabled

  return (
    <DropdownMenu modal onOpenChange={setMenuOpen}>
      <Tooltip
        open={suppressTooltip ? false : undefined}
        delayDuration={300}
        disableHoverableContent
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('composer.openInsertPanel')}
              disabled={disabled}
              className={cn(
                'size-7 shrink-0 rounded-full p-0 text-muted-foreground shadow-none hover:bg-muted/50 hover:text-foreground',
                'aria-expanded:bg-muted/35 aria-expanded:text-foreground aria-expanded:hover:bg-muted/50',
                instantHoverMotionClass,
              )}
            >
              <Plus className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t('composer.insert')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={10}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
        className={cn(
          'flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col',
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_LIST_LIST_PADDING,
          DESKTOP_OVERLAY_LIST_LIST_GAP,
        )}
      >
        <DropdownMenuItem
          className={cn(
            'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
            DESKTOP_OVERLAY_LIST_ITEM,
            'text-popover-foreground',
          )}
          onSelect={() => {
            onInsertWorkspaceReference()
          }}
        >
          <AtSign className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('composer.insertWorkspaceFile')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPickLocalFile}
          className={cn(
            'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
            DESKTOP_OVERLAY_LIST_ITEM,
            'text-popover-foreground',
          )}
          onSelect={() => {
            void onPickLocalFile()
          }}
        >
          <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('composer.selectLocalFile')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(
            'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
            DESKTOP_OVERLAY_LIST_ITEM,
            'text-popover-foreground',
          )}
          onSelect={() => {
            onInsertSkillTrigger()
          }}
        >
          <SlashBadge />
          <span className="min-w-0 flex-1 truncate">{t('composer.slashCommand')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
