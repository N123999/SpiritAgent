import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { isNewSessionAction, type ActionPaletteItem } from '@/lib/action-palette'
import { SLASH_SUGGESTION_ICONS } from '@/lib/slash-command-icons'
import type { SkillSlashSuggestionKind } from '@/lib/skill-slash'

type ActionPickerRowProps = {
  item: ActionPaletteItem
}

function SlashCommandIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind]
  return <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
}

export function ActionPickerRow({ item }: ActionPickerRowProps) {
  const { t } = useTranslation()

  if (isNewSessionAction(item)) {
    return (
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <Plus className="size-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="shrink-0 whitespace-nowrap text-sm font-medium leading-6 text-popover-foreground">
          {t(item.labelKey)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
          {t('actionPalette.newSessionDescription')}
        </span>
      </div>
    )
  }

  const description = item.descriptionKey
    ? t(item.descriptionKey)
    : item.description ?? ''

  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
      <SlashCommandIcon kind={item.kind} />
      <span className="shrink-0 whitespace-nowrap text-sm font-medium leading-6 text-popover-foreground">
        {item.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
        {description}
      </span>
    </div>
  )
}
