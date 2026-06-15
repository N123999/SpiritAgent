import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { WorkspaceFilePickerRow } from '@/components/workspace-file-picker-row'
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DESKTOP_COMPOSER_SUGGESTION_MENU_SCROLL_VIEWPORT,
  DESKTOP_COMPOSER_SUGGESTION_MENU_SURFACE,
  instantHoverMotionClass,
} from '@/lib/desktop-chrome'
import { cn } from '@/lib/utils'

type WorkspaceFileReferenceMenuProps = {
  suggestions: string[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(path: string): void
}

export function WorkspaceFileReferenceMenu({
  suggestions,
  selectedIndex,
  onSelectIndex,
  onApplySuggestion,
}: WorkspaceFileReferenceMenuProps) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selectedIndex < 0) {
      return
    }

    const selectedItem = scrollViewportRef.current?.querySelector<HTMLElement>(
      `[data-workspace-file-reference-index="${selectedIndex}"]`,
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, suggestions])

  return (
    <Command
      shouldFilter={false}
      aria-label={t('workspace.fileReferenceCandidates')}
      className={cn('p-1.5', DESKTOP_COMPOSER_SUGGESTION_MENU_SURFACE)}
    >
      <div
        ref={scrollViewportRef}
        className={DESKTOP_COMPOSER_SUGGESTION_MENU_SCROLL_VIEWPORT}
      >
        <CommandList className="max-h-none overflow-visible" onMouseLeave={() => onSelectIndex(-1)}>
          {suggestions.map((path, index) => (
            <CommandItem
              key={path}
              value={path}
              data-workspace-file-reference-index={index}
              className={cn(
                'min-w-0 cursor-pointer rounded-xl px-3 py-2 [&>svg:last-child]:hidden',
                instantHoverMotionClass,
                index === selectedIndex
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-foreground hover:bg-foreground/[0.05]',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onSelectIndex(index)}
              onFocus={() => onSelectIndex(index)}
              onSelect={() => onApplySuggestion(path)}
            >
              <WorkspaceFilePickerRow path={path} tone="menu" />
            </CommandItem>
          ))}
          <CommandEmpty className="px-3 py-2.5 text-left text-sm text-muted-foreground">
            {t('app.noMatches')}
          </CommandEmpty>
        </CommandList>
      </div>
    </Command>
  )
}
