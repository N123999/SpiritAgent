import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";

import { FractionProgressRing } from "@/components/fraction-progress-ring";
import { resolvePrTestPlanProgressVariant } from "@/lib/github-pr-list-ui";
import { cn } from "@/lib/utils";
import type { GitHubPullRequestTaskListProgress } from "@/types";

export type PrTestPlanProgressProps = {
  progress: GitHubPullRequestTaskListProgress;
  className?: string;
};

export function PrTestPlanProgress({ progress, className }: PrTestPlanProgressProps) {
  const { t } = useTranslation();
  const variant = resolvePrTestPlanProgressVariant(progress);

  if (variant === "none") {
    return null;
  }

  const { completed, total } = progress;

  if (variant === "zero") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65",
          className,
        )}
      >
        <ListChecks className="size-3 shrink-0" aria-hidden />
        {t("workspace.prListTestsCount", { count: total })}
      </span>
    );
  }

  if (variant === "partial") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65",
          className,
        )}
      >
        <FractionProgressRing
          completed={completed}
          total={total}
          aria-label={t("workspace.prListTestsProgressAria", { completed, total })}
        />
        {t("workspace.prListTestsPartial", { completed, total })}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/75 dark:text-muted-foreground/65",
        className,
      )}
    >
      <FractionProgressRing
        completed={total}
        total={total}
        aria-label={t("workspace.prListTasksDoneAria", { count: total })}
      />
      {t("workspace.prListTasksDone", { count: total })}
    </span>
  );
}
