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
  formatWeekly?(weekday: string, time: string): string;
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
  if (labels.formatWeekly) {
    return labels.formatWeekly(weekday, time);
  }
  return `${labels.weeklyPrefix} ${weekday} ${time}`;
}

function isValidHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isValidMinute(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 59;
}

function isValidWeekday(value: unknown): value is DesktopAutomationWeekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

export function isValidDesktopAutomationSchedule(schedule: DesktopAutomationSchedule): boolean {
  if (schedule.kind === 'hourly') {
    return true;
  }
  if (schedule.kind === 'daily') {
    return isValidHour(schedule.hour) && isValidMinute(schedule.minute);
  }
  return (
    isValidWeekday(schedule.weekday)
    && isValidHour(schedule.hour)
    && isValidMinute(schedule.minute)
  );
}
