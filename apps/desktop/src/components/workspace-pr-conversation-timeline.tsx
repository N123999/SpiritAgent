import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Check, ChevronRight, CircleX, Eye, GitCommit, MessageSquare } from "lucide-react";

import { ReviewCommentHunkView } from "@/components/review-comment-hunk-view";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsibleChildMount } from "@/hooks/use-collapsible-child-mount";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { resolveGitHubAvatarUrl } from "@/lib/github-avatar-url";
import { cn } from "@/lib/utils";
import type {
  GitHubPullRequestConversationIssueComment,
  GitHubPullRequestConversationItem,
  GitHubPullRequestConversationReview,
  GitHubPullRequestConversationReviewThread,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewState,
} from "@/types";

const NODE_COLUMN_PX = 20;
const ROW_AVATAR_SIZE_PX = 20;
/** Matches avatar (size-5) + gap-2 — aligns card with username start without ml + w-full overflow. */
const COMMENT_CARD_INDENT_SPACER_CLASS = "w-7 shrink-0";
const COMMENT_CARD_SURFACE_CLASS =
  "rounded-lg border border-border/50 bg-muted px-3 py-2 shadow-sm";
const FILE_THREAD_CARD_CLASS =
  "overflow-hidden rounded-lg border border-border/50 bg-muted shadow-sm";
const FILE_THREAD_DIFF_CLASS =
  "max-h-48 w-full rounded-none border-x-0 border-t border-b-0 border-border/20";
const FILE_THREAD_BODY_CLASS = "space-y-2 px-3 py-2";
/** Nested reply text indent (same offset as card spacer). */
const COMMENT_CARD_INDENT_CLASS = "ml-7";
const COMMENT_BODY_CLASS = "whitespace-pre-wrap text-xs leading-relaxed text-foreground/80";
/** Vertical gap between timeline rows (commits, comments, reviews). */
const TIMELINE_ITEMS_CLASS = "space-y-4";

export type PrConversationTimelineProps = {
  items: GitHubPullRequestConversationItem[];
  loading?: boolean;
  className?: string;
};

function PrConversationTimelineShell({
  node,
  children,
}: {
  node: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative flex gap-2">
      <div className="relative shrink-0" style={{ width: NODE_COLUMN_PX }}>
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 justify-center pt-0.5">{node}</div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PrConversationCommentHeader({
  login,
  avatarUrl,
  createdAt,
}: {
  login: string;
  avatarUrl: string;
  createdAt: string;
}) {
  const { i18n } = useTranslation();

  return (
    <div className="flex min-w-0 items-center gap-2">
      <PrConversationTimelineAvatar login={login} avatarUrl={avatarUrl} />
      <span className="truncate text-xs font-medium text-foreground/80">{login}</span>
      <time
        className="shrink-0 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65"
        dateTime={createdAt}
      >
        {formatRelativeTime(createdAt, i18n.language)}
      </time>
    </div>
  );
}

function PrConversationCommentCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="mt-2 flex min-w-0">
      <div className={COMMENT_CARD_INDENT_SPACER_CLASS} aria-hidden />
      <div className={cn(COMMENT_CARD_SURFACE_CLASS, "min-w-0 flex-1", className)}>{children}</div>
    </div>
  );
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

function PrConversationTimelineAvatar({
  login,
  avatarUrl,
  className,
}: {
  login: string;
  avatarUrl: string;
  className?: string;
}) {
  return (
    <img
      src={resolveGitHubAvatarUrl(login, avatarUrl)}
      alt=""
      className={cn("size-5 shrink-0 rounded-full bg-muted object-cover", className)}
      width={ROW_AVATAR_SIZE_PX}
      height={ROW_AVATAR_SIZE_PX}
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
    <div className="relative flex gap-2">
      <div className="relative shrink-0" style={{ width: NODE_COLUMN_PX }}>
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 justify-center pt-0.5">{node}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <PrConversationTimelineAvatar login={login} avatarUrl={avatarUrl} />
          <p className="truncate text-xs leading-relaxed text-muted-foreground">{headline}</p>
          <time
            className="shrink-0 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65"
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

function IssueCommentTimelineRow({ item }: { item: GitHubPullRequestConversationIssueComment }) {
  return (
    <PrConversationTimelineShell node={<PrConversationTimelineNode icon={MessageSquare} />}>
      <PrConversationCommentHeader
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        createdAt={item.createdAt}
      />
      {item.body ? (
        <PrConversationCommentCard>
          <p className={COMMENT_BODY_CLASS}>{item.body}</p>
        </PrConversationCommentCard>
      ) : null}
    </PrConversationTimelineShell>
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

function reviewActionKey(state: GitHubPullRequestReviewState): string {
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

function ReviewTimelineRow({ item }: { item: GitHubPullRequestConversationReview }) {
  const { t } = useTranslation();
  const Icon = reviewStateIcon(item.state);
  const cardText = item.body?.trim() || t(reviewActionKey(item.state));

  return (
    <PrConversationTimelineShell node={<PrConversationTimelineNode icon={Icon} />}>
      <PrConversationCommentHeader
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        createdAt={item.createdAt}
      />
      <PrConversationCommentCard>
        <p className={COMMENT_BODY_CLASS}>{cardText}</p>
      </PrConversationCommentCard>
      {item.threads.length > 0 ? (
        <div className="mt-2 space-y-2">
          {item.threads.map((thread) => (
            <ReviewFileThreadCard key={thread.id} thread={thread} />
          ))}
        </div>
      ) : null}
    </PrConversationTimelineShell>
  );
}

function ReviewThreadReply({ comment }: { comment: GitHubPullRequestReviewComment }) {
  return (
    <div className="border-t border-border/20 pt-2">
      <PrConversationCommentHeader
        login={comment.authorLogin}
        avatarUrl={comment.avatarUrl}
        createdAt={comment.createdAt}
      />
      {comment.body ? (
        <p className={cn(COMMENT_BODY_CLASS, COMMENT_CARD_INDENT_CLASS, "mt-1.5")}>{comment.body}</p>
      ) : null}
    </div>
  );
}

function ReviewFileThreadCard({ thread }: { thread: GitHubPullRequestConversationReviewThread }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mounted = useCollapsibleChildMount(open);

  const rootComment = thread.comments[0];
  const replies = thread.comments.slice(1);
  const rootBody = rootComment?.body?.trim() ?? "";

  return (
    <div className="flex min-w-0">
      <div className={COMMENT_CARD_INDENT_SPACER_CLASS} aria-hidden />
      <div className={cn(FILE_THREAD_CARD_CLASS, "min-w-0 flex-1")}>
        <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1 px-3 py-2 text-left outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-expanded={open}
            aria-label={open ? t("workspace.prReviewThreadCollapse") : t("workspace.prReviewThreadExpand")}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/55 transition-all duration-150",
                open && "rotate-90",
              )}
              aria-hidden
            />
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65">
              {thread.path}
              {thread.line != null ? `:${thread.line}` : ""}
            </span>
          </button>
          <CollapsibleContent>
            {mounted ? (
              <>
                <ReviewCommentHunkView
                  path={thread.path || "file"}
                  diffHunk={thread.diffHunk}
                  surface="card"
                  highlightLine={thread.line}
                  className={FILE_THREAD_DIFF_CLASS}
                />
                {rootBody || replies.length > 0 ? (
                  <div className={FILE_THREAD_BODY_CLASS}>
                    {rootBody ? <p className={COMMENT_BODY_CLASS}>{rootBody}</p> : null}
                    {replies.length > 0 ? (
                      <div className="space-y-2">
                        {replies.map((comment) => (
                          <ReviewThreadReply key={comment.id} comment={comment} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function ReviewThreadTimelineRow({ item }: { item: GitHubPullRequestConversationReviewThread }) {
  return (
    <PrConversationTimelineShell node={<PrConversationTimelineNode icon={MessageSquare} />}>
      <PrConversationCommentHeader
        login={item.authorLogin}
        avatarUrl={item.avatarUrl}
        createdAt={item.createdAt}
      />
      <div className="mt-2">
        <ReviewFileThreadCard thread={item} />
      </div>
    </PrConversationTimelineShell>
  );
}

function ConversationTimelineItemRow({ item }: { item: GitHubPullRequestConversationItem }) {
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
    return <IssueCommentTimelineRow item={item} />;
  }

  if (item.kind === "review") {
    return <ReviewTimelineRow item={item} />;
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
        <div className={TIMELINE_ITEMS_CLASS}>
          {items.map((item) => (
            <ConversationTimelineItemRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
