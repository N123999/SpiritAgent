import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check, CircleX, Eye, GitCommit, MessageSquare } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { resolveGitHubAvatarUrl } from "@/lib/github-avatar-url";
import { cn } from "@/lib/utils";
import type {
  GitHubPullRequestConversationItem,
  GitHubPullRequestReviewState,
} from "@/types";

const NODE_COLUMN_PX = 20;
const AVATAR_SIZE_PX = 20;

export type PrConversationTimelineProps = {
  items: GitHubPullRequestConversationItem[];
  loading?: boolean;
  className?: string;
};

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim();
  return line || "";
}

function PrConversationTimelineNode({
  icon: Icon,
  className,
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border border-border/40 bg-background",
        className,
      )}
      aria-hidden
    >
      <Icon className="size-2.5 text-muted-foreground" strokeWidth={2} />
    </div>
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

function reviewStateIcon(state: GitHubPullRequestReviewState): LucideIcon {
  switch (state) {
    case "APPROVED":
      return Check;
    case "CHANGES_REQUESTED":
      return CircleX;
    default:
      return Eye;
  }
}

function reviewHeadlineKey(state: GitHubPullRequestReviewState): string {
  switch (state) {
    case "APPROVED":
      return "workspace.prReviewApproved";
    case "CHANGES_REQUESTED":
      return "workspace.prReviewChangesRequested";
    case "DISMISSED":
      return "workspace.prReviewDismissed";
    default:
      return "workspace.prReviewCommented";
  }
}

function ConversationTimelineItemRow({ item }: { item: GitHubPullRequestConversationItem }) {
  const { t } = useTranslation();

  if (item.kind === "commit") {
    return (
      <PrConversationTimelineRow
        node={<PrConversationTimelineNode icon={GitCommit} />}
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        headline={item.subject}
        createdAt={item.createdAt}
      />
    );
  }

  if (item.kind === "issueComment") {
    const preview = firstLine(item.body);
    return (
      <PrConversationTimelineRow
        node={<PrConversationTimelineNode icon={MessageSquare} />}
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        headline={preview || t("workspace.prIssueCommentFallback")}
        createdAt={item.createdAt}
      >
        {item.body ? (
          <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/75 dark:text-muted-foreground/65">
            {item.body}
          </p>
        ) : null}
      </PrConversationTimelineRow>
    );
  }

  if (item.kind === "review") {
    const Icon = reviewStateIcon(item.state);
    const headline = t(reviewHeadlineKey(item.state), { login: item.authorLogin });
    return (
      <PrConversationTimelineRow
        node={<PrConversationTimelineNode icon={Icon} />}
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        headline={headline}
        createdAt={item.createdAt}
      >
        {item.body ? (
          <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/75 dark:text-muted-foreground/65">
            {item.body}
          </p>
        ) : null}
      </PrConversationTimelineRow>
    );
  }

  const rootComment = item.comments[0];
  const preview = firstLine(rootComment?.body ?? "");
  return (
    <PrConversationTimelineRow
      node={<PrConversationTimelineNode icon={MessageSquare} />}
      login={item.authorLogin}
      avatarUrl={item.avatarUrl}
      headline={
        item.path
          ? t("workspace.prReviewThreadOnFile", { path: item.path })
          : preview || t("workspace.prReviewThreadFallback")
      }
      createdAt={item.createdAt}
    >
      {preview ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/75 dark:text-muted-foreground/65">
          {rootComment?.body}
        </p>
      ) : null}
    </PrConversationTimelineRow>
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
            <ConversationTimelineItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
