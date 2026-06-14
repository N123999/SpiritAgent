import type { TFunction } from "i18next";

import type { DesktopAutomationTriggerFormatLabels } from "@/lib/automation-trigger";

export function buildAutomationTriggerFormatLabels(
  t: TFunction,
): DesktopAutomationTriggerFormatLabels {
  return {
    hourly: t("automations.schedule.hourly"),
    dailyPrefix: t("automations.schedule.daily"),
    weeklyPrefix: t("automations.schedule.weekly"),
    weekdays: [
      t("automations.schedule.weekday0"),
      t("automations.schedule.weekday1"),
      t("automations.schedule.weekday2"),
      t("automations.schedule.weekday3"),
      t("automations.schedule.weekday4"),
      t("automations.schedule.weekday5"),
      t("automations.schedule.weekday6"),
    ],
    formatWeekly: (weekday, time) => t("automations.schedule.weeklyAt", { weekday, time }),
    githubPrefix: t("automations.trigger.github"),
    githubPullRequestCreated: t("automations.trigger.pullRequestCreated"),
    githubIssueCreated: t("automations.trigger.issueCreated"),
  };
}
