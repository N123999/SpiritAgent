import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, GitPullRequest } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DetailPageTabs } from "@/components/detail-page-tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PrConversationTimeline } from "@/components/workspace-pr-conversation-timeline";
import { WorkspacePrChecksView } from "@/components/workspace-pr-checks-view";
import { WorkspacePrChangesView } from "@/components/workspace-pr-changes-view";
import { WorkspacePrMarkdown } from "@/components/workspace-pr-markdown";
import { WorkspacePrCommitsView } from "@/components/workspace-pr-commits-view";
import { GITHUB_PR_MERGED_BADGE_CLASS } from "@/lib/github-pr-merged-badge-styles";
import { toolCardSecondaryTextClass } from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type {
  GitHubPullRequestCheck,
  GitHubPullRequestChangedFile,
  GitHubPullRequestCommit,
  GitHubPullRequestConversationItem,
  GitHubPullRequestDetail,
} from "@/types";

export type WorkspacePrDetailViewProps = {
  detail: GitHubPullRequestDetail;
  conversationItems?: GitHubPullRequestConversationItem[];
  loadingConversation?: boolean;
  conversationHasMore?: boolean;
  changedFiles?: GitHubPullRequestChangedFile[];
  loadingChanges?: boolean;
  changesHasMore?: boolean;
  commits?: GitHubPullRequestCommit[];
  loadingCommits?: boolean;
  commitsHasMore?: boolean;
  checks?: GitHubPullRequestCheck[];
  loadingChecks?: boolean;
  checksHasMore?: boolean;
  onOpenExternal: (url: string) => void;
  className?: string;
};

type WorkspacePrDetailTab = "conversations" | "commits" | "checks" | "changes";

const PR_DETAIL_TABS: readonly WorkspacePrDetailTab[] = [
  "conversations",
  "commits",
  "checks",
  "changes",
];

const PR_DETAIL_TAB_LABEL_KEYS = {
  conversations: "workspace.prTabConversations",
  commits: "workspace.prTabCommits",
  checks: "workspace.prTabChecks",
  changes: "workspace.prTabChanges",
} as const satisfies Record<WorkspacePrDetailTab, string>;

function pullRequestStatusLabel(
  detail: GitHubPullRequestDetail,
  translate: (key: string) => string,
): string {
  if (detail.draft) {
    return translate("workspace.prDraft");
  }
  if (detail.state === "open") {
    return translate("workspace.prOpen");
  }
  return translate("workspace.prClosed");
}

export function WorkspacePrDetailView({
  detail,
  conversationItems = [],
  loadingConversation = false,
  conversationHasMore = false,
  changedFiles = [],
  loadingChanges = false,
  changesHasMore = false,
  commits = [],
  loadingCommits = false,
  commitsHasMore = false,
  checks = [],
  loadingChecks = false,
  checksHasMore = false,
  onOpenExternal,
  className,
}: WorkspacePrDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<WorkspacePrDetailTab>("conversations");

  return (
    <article className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", className)}>
      <header className="shrink-0 space-y-2 px-3 pt-3">
        <div className="min-w-0">
          <h2 className="m-0 flex flex-wrap items-center gap-2">
            <a
              href={detail.url}
              className="min-w-0 text-sm font-medium text-foreground focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              aria-label={t("workspace.prOpenOnGitHub")}
              onClick={(event) => {
                event.preventDefault();
                onOpenExternal(detail.url);
              }}
            >
              {detail.title}{" "}
              <span className="text-[13px] font-normal text-muted-foreground">#{detail.number}</span>
            </a>
            {!detail.merged ? (
              <Badge variant={detail.state === "open" ? "default" : "secondary"}>
                {pullRequestStatusLabel(detail, t)}
              </Badge>
            ) : null}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {detail.merged ? (
              <Badge className={GITHUB_PR_MERGED_BADGE_CLASS}>
                <GitPullRequest className="size-3 shrink-0" aria-hidden />
                {t("workspace.prMerged")}
              </Badge>
            ) : null}
            <span className="inline-flex flex-wrap items-center gap-x-1">
              <span>@{detail.authorLogin}</span>
              <span>{detail.headRef}</span>
              <ArrowRight
                className={cn("size-2.5 shrink-0", toolCardSecondaryTextClass)}
                aria-hidden
              />
              <span>{detail.baseRef}</span>
            </span>
          </div>
          {detail.body ? (
            <WorkspacePrMarkdown content={detail.body} className="mt-2" />
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{t("workspace.prNoDescription")}</p>
          )}
        </div>
      </header>

      <DetailPageTabs
        size="compact"
        tabs={PR_DETAIL_TABS.map((id) => ({
          id,
          label: t(PR_DETAIL_TAB_LABEL_KEYS[id]),
        }))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel={t("workspace.prDetailTabsAria")}
        edgeToPanelDivider
        className="min-h-0 flex-1"
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        {activeTab === "conversations" ? (
          <ScrollArea className="min-h-0 flex-1" type="auto">
            <div className="space-y-2 px-3 pt-3">
              <PrConversationTimeline items={conversationItems} loading={loadingConversation} />
              {conversationHasMore ? (
                <p className="text-xs text-muted-foreground/75 dark:text-muted-foreground/65">
                  {t("workspace.prConversationHasMore")}
                </p>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}
        {activeTab === "commits" ? (
          <WorkspacePrCommitsView
            commits={commits}
            loading={loadingCommits}
            hasMore={commitsHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
        {activeTab === "checks" ? (
          <WorkspacePrChecksView
            checks={checks}
            loading={loadingChecks}
            hasMore={checksHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
        {activeTab === "changes" ? (
          <WorkspacePrChangesView
            files={changedFiles}
            loading={loadingChanges}
            hasMore={changesHasMore}
            onOpenExternal={onOpenExternal}
            className="h-full min-h-0"
          />
        ) : null}
      </DetailPageTabs>
    </article>
  );
}
