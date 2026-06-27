import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ComposerSuggestionMenuItem } from '@/components/composer-suggestion-menu-item'
import { WorkspaceFilePickerRow } from '@/components/workspace-file-picker-row'

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
  const { t } = useTranslation()
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

  if (suggestions.length === 0) {
    return (
      <div className="px-2 py-2.5 text-xs text-muted-foreground">{t('app.noMatches')}</div>
    )
  }

  return (
    <div
      ref={scrollViewportRef}
      className="flex w-full min-w-0 flex-col gap-0.5"
      onMouseLeave={() => onSelectIndex(-1)}
    >
      {suggestions.map((path, index) => (
        <ComposerSuggestionMenuItem
          key={path}
          data-workspace-file-reference-index={index}
          selected={index === selectedIndex}
          title={path}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onSelectIndex(index)}
          onFocus={() => onSelectIndex(index)}
          onClick={() => onApplySuggestion(path)}
        >
          <WorkspaceFilePickerRow path={path} tone="menu" layout="stacked" />
        </ComposerSuggestionMenuItem>
      ))}
    </div>
  )
}
