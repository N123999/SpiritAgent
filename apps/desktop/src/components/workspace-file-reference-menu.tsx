import { File } from 'lucide-react'

import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

type WorkspaceFileReferenceMenuProps = {
  suggestions: string[]
  selectedIndex: number
  onSelectIndex(index: number): void
  onApplySuggestion(path: string): void
}

function basename(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

export function WorkspaceFileReferenceMenu({
  suggestions,
  selectedIndex,
  onSelectIndex,
  onApplySuggestion,
}: WorkspaceFileReferenceMenuProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/50 bg-background/85 shadow-lg backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/70">
      {suggestions.length > 0 ? (
        <ScrollArea
          className="[&>[data-radix-scroll-area-viewport]]:max-h-[min(48vh,32rem)] [&>[data-radix-scroll-area-viewport]]:overflow-x-hidden [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
          type="auto"
        >
          <div className="grid gap-0.5 p-1.5" onMouseLeave={() => onSelectIndex(-1)}>
            {suggestions.map((path, index) => (
              <button
                key={path}
                type="button"
                className={cn(
                  'w-full min-w-0 rounded-xl bg-transparent px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                  index === selectedIndex
                    ? 'bg-foreground/[0.06] text-foreground'
                    : 'text-foreground hover:bg-foreground/[0.05]',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onSelectIndex(index)}
                onFocus={() => onSelectIndex(index)}
                onClick={() => onApplySuggestion(path)}
              >
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,68%)] items-baseline gap-2 overflow-hidden">
                  <File className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden />
                  <div className="min-w-0 truncate text-sm font-medium leading-6 text-foreground">
                    {basename(path)}
                  </div>
                  <div className="min-w-0 truncate text-right text-xs leading-5 text-muted-foreground">
                    {path}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="px-3 py-2.5 text-sm text-muted-foreground">没有匹配项</div>
      )}
    </div>
  )
}
