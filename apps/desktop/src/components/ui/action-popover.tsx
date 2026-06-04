import { useRef, useState, type ReactNode } from 'react'
import { type VariantProps } from 'class-variance-authority'

import { Button, buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DESKTOP_COMPACT_ACTION_POPOVER_CONTENT,
  DESKTOP_COMPACT_ACTION_POPOVER_HEADING,
  DESKTOP_COMPACT_ACTION_POPOVER_ITEM,
  instantHoverMotionClass,
} from '@/lib/desktop-chrome'
import { cn } from '@/lib/utils'

export type ActionPopoverItem = {
  id: string
  icon: ReactNode
  label: string
  disabled?: boolean
  /** 悬停提示，常用于禁用项说明原因 */
  title?: string
  onSelect(): void | Promise<void>
}

type ActionPopoverProps = {
  ariaLabel: string
  title?: string
  heading?: string
  disabled?: boolean
  triggerIcon: ReactNode
  items: readonly ActionPopoverItem[]
  triggerClassName?: string
  contentClassName?: string
  /** 默认 ghost + 圆形，适合工具栏独立图标；ButtonGroup 分段请用 default + xs */
  triggerVariant?: VariantProps<typeof buttonVariants>['variant']
  triggerSize?: VariantProps<typeof buttonVariants>['size']
}

type ActionPopoverItemButtonProps = {
  disabled?: boolean
  icon: ReactNode
  label: string
  title?: string
  onClick(): void
}

function ActionPopoverItemButton({
  disabled = false,
  icon,
  label,
  title,
  onClick,
}: ActionPopoverItemButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      className={DESKTOP_COMPACT_ACTION_POPOVER_ITEM}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

export function ActionPopover({
  ariaLabel,
  title,
  heading,
  disabled = false,
  triggerIcon,
  items,
  triggerClassName,
  contentClassName,
  triggerVariant = 'ghost',
  triggerSize = 'icon',
}: ActionPopoverProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // Radix 在 trigger 的 pointerdown / click 与 outside-dismiss 之间会打架；
  // 这里记一拍，避免手动 toggle 后又被同次 click 反向切回去。
  const suppressTriggerClickRef = useRef(false)

  const closeAndRun = (action: () => void | Promise<void>) => {
    setOpen(false)
    void action()
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'shrink-0 shadow-none',
            triggerVariant === 'ghost' &&
              'size-7 rounded-full p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            instantHoverMotionClass,
            triggerClassName,
          )}
          title={title}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.ctrlKey || disabled) {
              return
            }
            suppressTriggerClickRef.current = true
            event.preventDefault()
            setOpen((current) => !current)
          }}
          onClick={(event) => {
            if (!suppressTriggerClickRef.current) {
              return
            }
            suppressTriggerClickRef.current = false
            event.preventDefault()
          }}
        >
          {triggerIcon}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        className={cn(DESKTOP_COMPACT_ACTION_POPOVER_CONTENT, contentClassName)}
        onPointerDownOutside={(event) => {
          const target = event.target
          if (!(target instanceof Node)) {
            return
          }
          if (triggerRef.current?.contains(target)) {
            // 点已打开的 trigger 时，应表现为一次正常 toggle；
            // 不要先在 pointerdown 阶段当 outside 关闭，再在 click 阶段重新打开。
            event.preventDefault()
          }
        }}
      >
        <div role="menu" aria-label={ariaLabel}>
          {heading ? (
            <div className={DESKTOP_COMPACT_ACTION_POPOVER_HEADING}>{heading}</div>
          ) : null}
          <div className="grid gap-0.5">
            {items.map((item) => (
              <ActionPopoverItemButton
                key={item.id}
                disabled={item.disabled}
                icon={item.icon}
                label={item.label}
                title={item.title}
                onClick={() => closeAndRun(item.onSelect)}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
