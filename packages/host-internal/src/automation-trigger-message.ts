import {
  formatScheduleLabel,
  type HostAutomationDefinition,
  type HostAutomationGitHubEvent,
  type HostAutomationTrigger,
} from './automations.js';

export const AUTOMATION_TRIGGER_OPEN = '<automation_trigger>';
export const AUTOMATION_TRIGGER_CLOSE = '</automation_trigger>';

export type AutomationRunTriggerContext =
  | { kind: 'time' }
  | {
      kind: 'github';
      event: HostAutomationGitHubEvent;
      eventUrl: string;
    };

export function formatGitHubAutomationEventLabel(event: HostAutomationGitHubEvent): string {
  if (event === 'pull_request_created') {
    return 'Pull request created';
  }
  return 'Issue created';
}

export function formatTimeAutomationEventLabel(
  trigger: Extract<HostAutomationTrigger, { kind: 'time' }>,
): string {
  return `Scheduled run (${formatScheduleLabel(trigger.schedule, {
    hourly: 'hourly',
    dailyPrefix: 'daily',
    weeklyPrefix: 'weekly',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    formatWeekly: (weekday, time) => `weekly ${weekday} ${time}`,
  })})`;
}

export function buildAutomationTriggerEventLine(
  trigger: HostAutomationTrigger,
  context: AutomationRunTriggerContext,
): string {
  if (context.kind === 'github' && trigger.kind === 'github') {
    return `${formatGitHubAutomationEventLabel(context.event)} (${context.eventUrl}).`;
  }
  if (trigger.kind === 'time') {
    return `${formatTimeAutomationEventLabel(trigger)}.`;
  }
  return 'Automation activated.';
}

export function buildAutomationTriggerMessage(input: {
  overview: string;
  trigger: HostAutomationTrigger;
  context: AutomationRunTriggerContext;
}): string {
  const overview = input.overview.trim();
  const eventLine = buildAutomationTriggerEventLine(input.trigger, input.context);
  const metaBlock = [
    AUTOMATION_TRIGGER_OPEN,
    'Automation activated.',
    `Event: ${eventLine}`,
    AUTOMATION_TRIGGER_CLOSE,
  ].join('\n');
  return overview ? `${metaBlock}\n\n${overview}` : metaBlock;
}

export function defaultAutomationRunTriggerContext(
  definition: HostAutomationDefinition,
): AutomationRunTriggerContext {
  if (definition.trigger.kind === 'github') {
    throw new Error('GitHub automation runs require an event URL context.');
  }
  return { kind: 'time' };
}
