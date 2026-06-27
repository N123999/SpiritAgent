import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ComposerSuggestionMenuItem } from '@/components/composer-suggestion-menu-item'
import {
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from '@/lib/desktop-chrome'
import { SLASH_SUGGESTION_ICONS } from '@/lib/slash-command-icons'
import type { SkillSlashSuggestion, SkillSlashSuggestionKind } from '@/lib/skill-slash'

type SkillSlashMenuProps = {
  suggestions: SkillSlashSuggestion[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(suggestion: SkillSlashSuggestion): void
}

function SlashSuggestionIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind]
  return <Icon className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
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
      {suggestions.map((suggestion, index) => {
        const description = suggestion.descriptionKey
          ? t(suggestion.descriptionKey)
          : suggestion.description ?? ''

        return (
          <ComposerSuggestionMenuItem
            key={suggestion.id}
            data-skill-slash-index={index}
            selected={index === selectedIndex}
            title={`${suggestion.name} — ${description}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onSelectIndex(index)}
            onFocus={() => onSelectIndex(index)}
            onClick={() => onApplySuggestion(suggestion)}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <SlashSuggestionIcon kind={suggestion.kind} />
              <div className="min-w-0 flex-1">
                <div className={DESKTOP_OVERLAY_LIST_ITEM_PRIMARY} title={suggestion.name}>
                  {suggestion.name}
                </div>
                <div className={DESKTOP_OVERLAY_LIST_ITEM_SECONDARY} title={description}>
                  {description}
                </div>
              </div>
            </div>
          </ComposerSuggestionMenuItem>
        )
      })}
    </div>
  )
}
