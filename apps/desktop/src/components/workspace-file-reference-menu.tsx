import { useEffect, useRef } from 'react'

import { File } from 'lucide-react'

import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { instantHoverMotionClass } from '@/lib/desktop-chrome'
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
      aria-label="工作区文件引用候选"
      className="overflow-hidden rounded-2xl border border-border/50 bg-background/85 p-1.5 shadow-lg backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/70"
    >
      <div
        ref={scrollViewportRef}
        className="no-scrollbar max-h-[min(16rem,34vh)] overscroll-contain overflow-x-hidden overflow-y-auto outline-none"
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
              <div className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_minmax(0,68%)] items-baseline gap-2 overflow-hidden">
                <File className="size-3.5 shrink-0 text-muted-foreground/75" aria-hidden />
                <div className="min-w-0 truncate text-sm font-medium leading-6 text-foreground">
                  {basename(path)}
                </div>
                <div className="min-w-0 truncate text-right text-xs leading-5 text-muted-foreground">
                  {path}
                </div>
              </div>
            </CommandItem>
          ))}
          <CommandEmpty className="px-3 py-2.5 text-left text-sm text-muted-foreground">
            没有匹配项
          </CommandEmpty>
        </CommandList>
      </div>
    </Command>
  )
}
