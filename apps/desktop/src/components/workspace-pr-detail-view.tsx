import { useTranslation } from "react-i18next";
import { ArrowRight, GitPullRequest } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GITHUB_PR_MERGED_BADGE_CLASS } from "@/lib/github-pr-merged-badge-styles";
import { toolCardSecondaryTextClass } from "@/lib/file-tool-lsp-diagnostics-display";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestDetail } from "@/types";

export type WorkspacePrDetailViewProps = {
  detail: GitHubPullRequestDetail;
  onOpenExternal: (url: string) => void;
  className?: string;
};

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
  onOpenExternal,
  className,
}: WorkspacePrDetailViewProps) {
  const { t } = useTranslation();

  return (
    <article className={cn("space-y-4", className)}>
      <header className="space-y-2">
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
        </div>
      </header>

      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
          {t("workspace.prDescriptionHeading")}
        </h3>
        {detail.body ? (
          <div className="whitespace-pre-wrap text-sm text-foreground/90">{detail.body}</div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("workspace.prNoDescription")}</p>
        )}
      </section>
    </article>
  );
}
