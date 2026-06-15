import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DESKTOP_COMPOSER_SUGGESTION_MENU_ITEM_HOVER,
  DESKTOP_COMPOSER_SUGGESTION_MENU_ITEM_SELECTED,
  DESKTOP_COMPOSER_SUGGESTION_MENU_SCROLL_VIEWPORT,
  DESKTOP_COMPOSER_SUGGESTION_MENU_SURFACE,
  instantHoverMotionClass,
} from '@/lib/desktop-chrome'
import { SLASH_SUGGESTION_ICONS } from '@/lib/slash-command-icons'
import { cn } from '@/lib/utils'
import type { SkillSlashSuggestion, SkillSlashSuggestionKind } from '@/lib/skill-slash'

type SkillSlashMenuProps = {
  suggestions: SkillSlashSuggestion[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(suggestion: SkillSlashSuggestion): void
}

function SlashSuggestionIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind]
  return <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
}

export function SkillSlashMenu({
  suggestions,
  selectedIndex,
  onSelectIndex,
  onApplySuggestion,
}: SkillSlashMenuProps) {
  const { t } = useTranslation()
  const scrollViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selectedIndex < 0) {
      return
    }

    const selectedItem = scrollViewportRef.current?.querySelector<HTMLElement>(
      `[data-skill-slash-index="${selectedIndex}"]`,
    )
    selectedItem?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, suggestions])

  return (
    <div className={cn('w-full min-w-0', DESKTOP_COMPOSER_SUGGESTION_MENU_SURFACE)}>
      <div ref={scrollViewportRef} className={DESKTOP_COMPOSER_SUGGESTION_MENU_SCROLL_VIEWPORT}>
        {suggestions.length > 0 ? (
          <div className="grid w-full min-w-0 gap-0.5 p-1.5" onMouseLeave={() => onSelectIndex(-1)}>
            {suggestions.map((suggestion, index) => {
              const description = suggestion.descriptionKey
                ? t(suggestion.descriptionKey)
                : suggestion.description ?? ''
              return (
                <button
                  key={suggestion.id}
                  type="button"
                  data-skill-slash-index={index}
                  title={`${suggestion.name} — ${description}`}
                  className={cn(
                    'w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-transparent px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    instantHoverMotionClass,
                    DESKTOP_COMPOSER_SUGGESTION_MENU_ITEM_HOVER,
                    index === selectedIndex
                      ? DESKTOP_COMPOSER_SUGGESTION_MENU_ITEM_SELECTED
                      : 'text-foreground',
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => onSelectIndex(index)}
                  onFocus={() => onSelectIndex(index)}
                  onClick={() => onApplySuggestion(suggestion)}
                >
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <SlashSuggestionIcon kind={suggestion.kind} />
                    <span className="shrink-0 whitespace-nowrap text-sm font-medium leading-6 text-foreground">
                      {suggestion.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
                      {description}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-2.5 text-sm text-muted-foreground">{t('app.noMatches')}</div>
        )}
      </div>
    </div>
  )
}
