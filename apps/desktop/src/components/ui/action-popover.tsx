import { type ReactNode } from 'react'
import { type VariantProps } from 'class-variance-authority'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
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
  return (
    <DropdownMenu modal>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'shrink-0 shadow-none',
            triggerVariant === 'ghost' &&
              cn(
                'size-7 rounded-full p-0 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                'aria-expanded:bg-muted/35 aria-expanded:text-foreground aria-expanded:hover:bg-muted/50',
              ),
            instantHoverMotionClass,
            triggerClassName,
          )}
          title={title}
        >
          {triggerIcon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={10}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        className={cn(
          'flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col',
          DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
          DESKTOP_OVERLAY_LIST_LIST_PADDING,
          DESKTOP_OVERLAY_LIST_LIST_GAP,
          contentClassName,
        )}
      >
        {heading ? (
          <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>{heading}</div>
        ) : null}
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            disabled={item.disabled}
            title={item.title}
            className={cn(
              'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
              DESKTOP_OVERLAY_LIST_ITEM,
              'text-popover-foreground',
            )}
            onSelect={() => {
              void item.onSelect()
            }}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
