import { cn } from '@/lib/utils'
import type { SkillSlashSuggestion } from '@/lib/skill-slash'

type SkillSlashMenuProps = {
  suggestions: SkillSlashSuggestion[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(suggestion: SkillSlashSuggestion): void
}

export function SkillSlashMenu({
  suggestions,
  selectedIndex,
  onSelectIndex,
  onApplySuggestion,
}: SkillSlashMenuProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
      {suggestions.length > 0 ? (
        <div className="grid gap-0.5 p-1.5" onMouseLeave={() => onSelectIndex(-1)}>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              className={cn(
                'rounded-xl bg-transparent px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                index === selectedIndex
                  ? 'bg-foreground/[0.06] text-foreground'
                  : 'text-foreground hover:bg-foreground/[0.05]',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onSelectIndex(index)}
              onFocus={() => onSelectIndex(index)}
              onClick={() => onApplySuggestion(suggestion)}
            >
              <div className="flex items-baseline gap-2 overflow-hidden">
                <span className="shrink-0 text-sm font-medium leading-6 text-foreground">
                  {suggestion.name}
                </span>
                <span className="min-w-0 truncate text-xs leading-6 text-muted-foreground">
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