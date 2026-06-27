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

  if (suggestions.length === 0) {
    return (
      <div className="px-2 py-2.5 text-xs text-muted-foreground">{t('app.noMatches')}</div>
    )
  }

  return (
    <>
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
    </>
  )
}
