/** Renderer-safe automation trigger types and labels. Do not import host-internal here. */

import type {
  DesktopAutomationSchedule,
  DesktopAutomationScheduleFormatLabels,
} from './automation-schedule.js';
import {
  formatDesktopAutomationScheduleLabel,
  isValidDesktopAutomationSchedule,
} from './automation-schedule.js';

export type DesktopAutomationGitHubEvent = 'pull_request_created' | 'issue_created';

export type DesktopAutomationTrigger =
  | { kind: 'time'; schedule: DesktopAutomationSchedule }
  | {
      kind: 'github';
      owner: string;
      repo: string;
      event: DesktopAutomationGitHubEvent;
      poll?: { lastSeenNumber: number };
    };

export interface DesktopAutomationTriggerFormatLabels extends DesktopAutomationScheduleFormatLabels {
  githubPrefix: string;
  githubPullRequestCreated: string;
  githubIssueCreated: string;
}

export function formatDesktopAutomationTriggerLabel(
  trigger: DesktopAutomationTrigger,
  labels: DesktopAutomationTriggerFormatLabels,
): string {
  if (trigger.kind === 'time') {
    return formatDesktopAutomationScheduleLabel(trigger.schedule, labels);
  }
  const eventLabel =
    trigger.event === 'pull_request_created'
      ? labels.githubPullRequestCreated
      : labels.githubIssueCreated;
  return `${labels.githubPrefix} · ${trigger.owner}/${trigger.repo} · ${eventLabel}`;
}

export function defaultDesktopTimeTrigger(
  schedule: DesktopAutomationSchedule = { kind: 'daily', hour: 20, minute: 0 },
): DesktopAutomationTrigger {
  return { kind: 'time', schedule };
}

export function isValidDesktopAutomationTrigger(trigger: DesktopAutomationTrigger): boolean {
  if (trigger.kind === 'time') {
    return isValidDesktopAutomationSchedule(trigger.schedule);
  }
  return Boolean(trigger.owner.trim() && trigger.repo.trim());
}
