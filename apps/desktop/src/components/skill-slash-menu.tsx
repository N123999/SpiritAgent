import type { LucideIcon } from 'lucide-react'
import {
  FoldVertical,
  Rocket,
  ScrollText,
  Sparkles,
  Wand2,
} from 'lucide-react'

import { instantHoverMotionClass } from '@/lib/desktop-chrome'
import { cn } from '@/lib/utils'
import type { SkillSlashSuggestion, SkillSlashSuggestionKind } from '@/lib/skill-slash'

type SkillSlashMenuProps = {
  suggestions: SkillSlashSuggestion[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(suggestion: SkillSlashSuggestion): void
}

const SLASH_SUGGESTION_ICONS: Record<SkillSlashSuggestionKind, LucideIcon> = {
  'create-skill': Wand2,
  'log-session': ScrollText,
  'start-implementing': Rocket,
  compact: FoldVertical,
  skill: Sparkles,
}

function SlashSuggestionIcon({ kind }: { kind: SkillSlashSuggestionKind }) {
  const Icon = SLASH_SUGGESTION_ICONS[kind]
  return <Icon className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden />
}

export function SkillSlashMenu({
  suggestions,
  selectedIndex,
  onSelectIndex,
  onApplySuggestion,
}: SkillSlashMenuProps) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
      {suggestions.length > 0 ? (
        <div className="grid w-full min-w-0 gap-0.5 p-1.5" onMouseLeave={() => onSelectIndex(-1)}>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              title={`${suggestion.name} — ${suggestion.description}`}
              className={cn(
                'w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-transparent px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                instantHoverMotionClass,
                index === selectedIndex
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-foreground hover:bg-foreground/[0.05]',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onSelectIndex(index)}
              onFocus={() => onSelectIndex(index)}
              onClick={() => onApplySuggestion(suggestion)}
            >
              <div className="flex min-w-0 items-baseline gap-2 overflow-hidden">
                <SlashSuggestionIcon kind={suggestion.kind} />
                <span className="shrink-0 whitespace-nowrap text-sm font-medium leading-6 text-foreground">
                  {suggestion.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs leading-6 text-muted-foreground">
                  {suggestion.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2.5 text-sm text-muted-foreground">没有匹配项</div>
      )}
    </div>
  )
}
