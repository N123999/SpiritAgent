import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { resolveGitHubAvatarUrl } from "@/lib/github-avatar-url";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestConversationItem } from "@/types";

const NODE_COLUMN_PX = 20;
const AVATAR_SIZE_PX = 20;

export type PrConversationTimelineProps = {
  items: GitHubPullRequestConversationItem[];
  loading?: boolean;
  className?: string;
};

function PrConversationTimelineNode({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border border-border/40 bg-background",
        className,
      )}
      aria-hidden
    />
  );
}

function PrConversationTimelineAvatar({ login, avatarUrl }: { login: string; avatarUrl: string }) {
  return (
    <img
      src={resolveGitHubAvatarUrl(login, avatarUrl)}
      alt=""
      className="size-5 shrink-0 rounded-full bg-muted object-cover"
      width={AVATAR_SIZE_PX}
      height={AVATAR_SIZE_PX}
      loading="lazy"
    />
  );
}

function PrConversationTimelineRow({
  node,
  login,
  avatarUrl,
  headline,
  createdAt,
  children,
}: {
  node: ReactNode;
  login: string;
  avatarUrl: string;
  headline: string;
  createdAt: string;
  children?: ReactNode;
}) {
  const { i18n } = useTranslation();

  return (
    <div className="relative flex gap-2 pb-3 last:pb-0">
      <div className="relative shrink-0" style={{ width: NODE_COLUMN_PX }}>
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 justify-center pt-0.5">{node}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <PrConversationTimelineAvatar login={login} avatarUrl={avatarUrl} />
          <p className="min-w-0 flex-1 truncate text-xs leading-relaxed text-muted-foreground">
            {headline}
          </p>
          <time
            className="shrink-0 text-xs text-muted-foreground/75 dark:text-muted-foreground/65"
            dateTime={createdAt}
          >
            {formatRelativeTime(createdAt, i18n.language)}
          </time>
        </div>
        {children ? <div className="mt-1.5 pl-7">{children}</div> : null}
      </div>
    </div>
  );
}

function PrConversationTimelinePlaceholderRow({ label }: { label: string }) {
  return (
    <PrConversationTimelineRow
      node={<PrConversationTimelineNode />}
      login="octocat"
      avatarUrl=""
      headline={label}
      createdAt={new Date().toISOString()}
    />
  );
}

export function PrConversationTimeline({
  items,
  loading = false,
  className,
}: PrConversationTimelineProps) {
  const { t } = useTranslation();

  if (loading) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{t("workspace.prLoading")}</p>;
  }

  if (items.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("workspace.prConversationEmpty")}
      </p>
    );
  }

  return (
    <ScrollArea className={cn("min-h-0 flex-1", className)}>
      <div className="relative pr-1">
        <div
          className="pointer-events-none absolute bottom-2 top-2 w-px bg-border/40"
          style={{ left: NODE_COLUMN_PX / 2 - 0.5 }}
          aria-hidden
        />
        <div className="space-y-0">
          {items.map((item) => (
            <PrConversationTimelinePlaceholderRow key={item.id} label={item.kind} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
