import { useTranslation } from "react-i18next";
import { GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";

import { PrTestPlanProgress } from "@/components/pr-test-plan-progress";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { resolvePullRequestListIconTone } from "@/lib/github-pr-list-ui";
import { GITHUB_PR_MERGED_ICON_CLASS } from "@/lib/github-pr-merged-badge-styles";
import { resolveGitHubAvatarUrl } from "@/lib/github-avatar-url";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestListItem } from "@/types";

export type WorkspacePrListRowProps = {
  item: GitHubPullRequestListItem;
  onSelect?: (item: GitHubPullRequestListItem) => void;
};

function resolvePullRequestIconClass(item: GitHubPullRequestListItem): string {
  const tone = resolvePullRequestListIconTone(item);
  if (tone === "merged") {
    return GITHUB_PR_MERGED_ICON_CLASS;
  }
  if (tone === "draft") {
    return "text-foreground/75 dark:text-foreground/70";
  }
  if (tone === "open") {
    return "text-[#296837] dark:text-[#57a773]";
  }
  return "text-muted-foreground";
}

function PullRequestListIcon({ item }: { item: GitHubPullRequestListItem }) {
  const iconClass = cn("size-4 shrink-0", resolvePullRequestIconClass(item));

  if (item.merged) {
    return <GitPullRequest className={iconClass} aria-hidden />;
  }
  if (item.draft) {
    return <GitPullRequestDraft className={iconClass} aria-hidden />;
  }
  if (item.state === "open") {
    return <GitPullRequest className={iconClass} aria-hidden />;
  }
  return <GitPullRequestClosed className={iconClass} aria-hidden />;
}

export function WorkspacePrListRow({ item, onSelect }: WorkspacePrListRowProps) {
  const { t, i18n } = useTranslation();
  const avatarUrl = resolveGitHubAvatarUrl(item.authorLogin, item.authorAvatarUrl);
  const updatedAt = item.updatedAt || item.createdAt;

  const row = (
    <div className="flex min-w-0 items-center gap-2 px-3 py-3">
      <PullRequestListIcon item={item} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-xs text-foreground">{item.title}</p>
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={avatarUrl}
            alt=""
            className="size-5 shrink-0 rounded-full bg-muted object-cover"
          />
          <span className="truncate text-xs font-medium text-foreground/80">{item.authorLogin}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65">
            #{item.number}
          </span>
          <time
            className="shrink-0 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65"
            dateTime={updatedAt}
          >
            {formatRelativeTime(updatedAt, i18n.language)}
          </time>
          {item.taskListProgress ? (
            <PrTestPlanProgress progress={item.taskListProgress} className="ml-auto" />
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!onSelect) {
    return row;
  }

  return (
    <button
      type="button"
      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      onClick={() => onSelect(item)}
      aria-label={t("workspace.prListOpenDetailAria", {
        number: item.number,
        title: item.title,
      })}
    >
      {row}
    </button>
  );
}
