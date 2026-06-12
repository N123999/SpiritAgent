import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check, ChevronDown, CircleX, Eye, GitCommit, MessageSquare } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { resolveGitHubAvatarUrl } from "@/lib/github-avatar-url";
import { cn } from "@/lib/utils";
import type {
  GitHubPullRequestConversationItem,
  GitHubPullRequestConversationReviewThread,
  GitHubPullRequestReviewComment,
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

function ReviewThreadComment({
  comment,
}: {
  comment: GitHubPullRequestReviewComment;
}) {
  const { i18n } = useTranslation();

  return (
    <div className="flex gap-2 border-t border-border/20 pt-2 first:border-t-0 first:pt-0">
      <PrConversationTimelineAvatar login={comment.authorLogin} avatarUrl={comment.avatarUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-foreground/80">@{comment.authorLogin}</span>
          <time
            className="text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65"
            dateTime={comment.createdAt}
          >
            {formatRelativeTime(comment.createdAt, i18n.language)}
          </time>
        </div>
        {comment.body ? (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/75 dark:text-muted-foreground/65">
            {comment.body}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ReviewThreadTimelineRow({ item }: { item: GitHubPullRequestConversationReviewThread }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mounted = useCollapsibleChildMount(open);

  const rootComment = item.comments[0];
  const preview = firstLine(rootComment?.body ?? "");
  const headline = item.path
    ? t("workspace.prReviewThreadOnFile", { path: item.path })
    : preview || t("workspace.prReviewThreadFallback");

  return (
    <PrConversationTimelineRow
      node={<PrConversationTimelineNode icon={MessageSquare} />}
      login={item.authorLogin}
      avatarUrl={item.avatarUrl}
      headline={headline}
      createdAt={item.createdAt}
    >
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
        <button
          type="button"
          className="group flex w-full items-center gap-1 text-left text-xs text-muted-foreground/75 hover:text-muted-foreground dark:text-muted-foreground/65"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            className={cn(
              "size-3 shrink-0 transition-transform duration-150",
              open ? "rotate-180" : "rotate-0",
            )}
            aria-hidden
          />
          {open ? t("workspace.prReviewThreadCollapse") : t("workspace.prReviewThreadExpand")}
        </button>
        <CollapsibleContent className="mt-2 space-y-2">
          {mounted ? (
            <>
              {item.path ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65">
                  {item.path}
                  {item.line != null ? `:${item.line}` : ""}
                </p>
              ) : null}
              <ReviewCommentHunkView path={item.path || "file"} diffHunk={item.diffHunk} />
              <div className="space-y-2">
                {item.comments.map((comment) => (
                  <ReviewThreadComment key={comment.id} comment={comment} />
                ))}
              </div>
            </>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </PrConversationTimelineRow>
  );
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

  if (item.kind === "reviewThread") {
    return <ReviewThreadTimelineRow item={item} />;
  }

  return null;
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
