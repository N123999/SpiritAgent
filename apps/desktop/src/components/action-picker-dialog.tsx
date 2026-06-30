import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ActionPickerRow } from '@/components/action-picker-row'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  buildActionPaletteItems,
  isNewSessionAction,
  type ActionPaletteItem,
} from '@/lib/action-palette'
import { instantHoverMotionClass } from '@/lib/desktop-chrome'
import { RADIX_OVERLAY_CLOSE_MS } from '@/lib/overlay-motion'
import { cn } from '@/lib/utils'

type ActionPickerDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  onSelect(item: ActionPaletteItem): void
  isItemDisabled?(item: ActionPaletteItem): boolean
}

function actionPaletteItemValue(item: ActionPaletteItem): string {
  return isNewSessionAction(item) ? item.id : item.id
}

export function ActionPickerDialog({
  open,
  onOpenChange,
  onSelect,
  isItemDisabled,
}: ActionPickerDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (open) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setQuery('')
    }, RADIX_OVERLAY_CLOSE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [open])

  const items = useMemo(
    () => buildActionPaletteItems(query, t),
    [query, t],
  )

  const closeAndSelect = (item: ActionPaletteItem) => {
    if (isItemDisabled?.(item)) {
      return
    }
    onOpenChange(false)
    onSelect(item)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('actionPalette.title')}
      description={t('actionPalette.description')}
      className="sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        aria-label={t('actionPalette.title')}
        className="gap-2"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={t('actionPalette.placeholder')}
        />
        <CommandList className="max-h-96">
          {items.map((item) => {
            const disabled = isItemDisabled?.(item) ?? false
            return (
              <CommandItem
                key={actionPaletteItemValue(item)}
                value={actionPaletteItemValue(item)}
                disabled={disabled}
                className={cn(
                  'min-w-0 cursor-pointer [&>svg:last-child]:hidden',
                  instantHoverMotionClass,
                  disabled && 'pointer-events-none opacity-50',
                )}
                onSelect={() => closeAndSelect(item)}
              >
                <ActionPickerRow item={item} />
              </CommandItem>
            )
          })}
          {items.length === 0 ? (
            <CommandEmpty>{t('actionPalette.empty')}</CommandEmpty>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
