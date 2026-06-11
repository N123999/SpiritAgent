import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Send, Trash2 } from 'lucide-react';

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
} from '@/lib/desktop-chrome';
import { cn } from '@/lib/utils';

type QueuedUserMessageHoverActionsProps = {
  queueId: string;
  canMoveUp: boolean;
  busy?: boolean;
  onMoveUp(queueId: string): void | Promise<void>;
  onSendNow(queueId: string): void | Promise<void>;
  onDelete(queueId: string): void | Promise<void>;
  children: ReactNode;
};

type QueueActionButtonProps = {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick(): void;
};

function QueueActionButton({ disabled = false, icon, label, onClick }: QueueActionButtonProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        'flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none',
        DESKTOP_OVERLAY_LIST_ITEM,
        'text-popover-foreground hover:bg-accent hover:text-accent-foreground',
        'focus-visible:bg-accent focus-visible:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

export function QueuedUserMessageHoverActions({
  queueId,
  canMoveUp,
  busy = false,
  onMoveUp,
  onSendNow,
  onDelete,
  children,
}: QueuedUserMessageHoverActionsProps) {
  const { t } = useTranslation();

  return (
    <HoverCard openDelay={50} closeDelay={80}>
      <HoverCardTrigger asChild>
        <div className="inline-flex max-w-full">{children}</div>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="end"
        sideOffset={8}
        className={cn(DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE, 'w-44 p-0')}
        aria-label={t('queue.actionsAria')}
      >
        <div
          role="menu"
          className={cn('flex flex-col', DESKTOP_OVERLAY_LIST_LIST_PADDING, DESKTOP_OVERLAY_LIST_LIST_GAP)}
        >
          <QueueActionButton
            disabled={busy || !canMoveUp}
            icon={<ArrowUp className="size-3.5 shrink-0" aria-hidden />}
            label={t('queue.moveUp')}
            onClick={() => {
              void onMoveUp(queueId);
            }}
          />
          <QueueActionButton
            disabled={busy}
            icon={<Send className="size-3.5 shrink-0" aria-hidden />}
            label={t('queue.sendNow')}
            onClick={() => {
              void onSendNow(queueId);
            }}
          />
          <QueueActionButton
            disabled={busy}
            icon={<Trash2 className="size-3.5 shrink-0" aria-hidden />}
            label={t('queue.delete')}
            onClick={() => {
              void onDelete(queueId);
            }}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
