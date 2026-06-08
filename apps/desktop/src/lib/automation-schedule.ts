/** Renderer-safe automation schedule types and labels. Do not import host-internal here. */

export type DesktopAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DesktopAutomationSchedule =
  | { kind: 'hourly' }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: DesktopAutomationWeekday; hour: number; minute: number };

export interface DesktopAutomationScheduleFormatLabels {
  hourly: string;
  dailyPrefix: string;
  weeklyPrefix: string;
  weekdays: readonly string[];
}

function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDesktopAutomationScheduleLabel(
  schedule: DesktopAutomationSchedule,
  labels: DesktopAutomationScheduleFormatLabels,
): string {
  if (schedule.kind === 'hourly') {
    return labels.hourly;
  }
  const time = formatTimeOfDay(schedule.hour, schedule.minute);
  if (schedule.kind === 'daily') {
    return `${labels.dailyPrefix} ${time}`;
  }
  const weekday = labels.weekdays[schedule.weekday] ?? String(schedule.weekday);
  return `${labels.weeklyPrefix} ${weekday} ${time}`;
}
