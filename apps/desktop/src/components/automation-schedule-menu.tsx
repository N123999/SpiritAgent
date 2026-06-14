import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH } from "@/lib/desktop-chrome";
import {
  formatDesktopAutomationScheduleLabel,
  type DesktopAutomationSchedule,
  type DesktopAutomationWeekday,
} from "@/lib/automation-schedule";
import { cn } from "@/lib/utils";

const WEEKDAY_OPTIONS: Array<{ value: DesktopAutomationWeekday; labelKey: string }> = [
  { value: 0, labelKey: "automations.schedule.weekday0" },
  { value: 1, labelKey: "automations.schedule.weekday1" },
  { value: 2, labelKey: "automations.schedule.weekday2" },
  { value: 3, labelKey: "automations.schedule.weekday3" },
  { value: 4, labelKey: "automations.schedule.weekday4" },
  { value: 5, labelKey: "automations.schedule.weekday5" },
  { value: 6, labelKey: "automations.schedule.weekday6" },
];

function hourOptions(): number[] {
  return Array.from({ length: 24 }, (_, index) => index);
}

function minuteOptions(): number[] {
  return Array.from({ length: 60 }, (_, index) => index);
}

function resolveDailyTime(schedule: DesktopAutomationSchedule): { hour: number; minute: number } {
  if (schedule.kind === "daily" || schedule.kind === "weekly") {
    return { hour: schedule.hour, minute: schedule.minute };
  }
  return { hour: 20, minute: 0 };
}

function resolveWeeklyWeekday(schedule: DesktopAutomationSchedule): DesktopAutomationWeekday {
  if (schedule.kind === "weekly") {
    return schedule.weekday;
  }
  return 1;
}

function toDailySchedule(schedule: DesktopAutomationSchedule): Extract<DesktopAutomationSchedule, { kind: "daily" }> {
  const { hour, minute } = resolveDailyTime(schedule);
  return { kind: "daily", hour, minute };
}

function toWeeklySchedule(schedule: DesktopAutomationSchedule): Extract<DesktopAutomationSchedule, { kind: "weekly" }> {
  const { hour, minute } = resolveDailyTime(schedule);
  return { kind: "weekly", weekday: resolveWeeklyWeekday(schedule), hour, minute };
}

type AutomationScheduleMenuProps = {
  schedule: DesktopAutomationSchedule;
  disabled?: boolean;
  onScheduleChange(schedule: DesktopAutomationSchedule): void;
};

export function AutomationTimeScheduleOptions({
  schedule,
  disabled,
  onScheduleChange,
}: AutomationScheduleMenuProps) {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => onScheduleChange({ kind: "hourly" })}
      >
        {t("automations.schedule.hourly")}
      </DropdownMenuItem>
      <DailyScheduleSub
        title={t("automations.schedule.daily")}
        schedule={schedule}
        onScheduleChange={onScheduleChange}
      />
      <WeeklyScheduleSub
        title={t("automations.schedule.weekly")}
        schedule={schedule}
        onScheduleChange={onScheduleChange}
      />
    </>
  );
}

export function AutomationScheduleMenu({
  schedule,
  disabled,
  onScheduleChange,
}: AutomationScheduleMenuProps) {
  const { t } = useTranslation();
  const label = formatDesktopAutomationScheduleLabel(schedule, {
    hourly: t("automations.schedule.hourly"),
    dailyPrefix: t("automations.schedule.daily"),
    weeklyPrefix: t("automations.schedule.weekly"),
    weekdays: WEEKDAY_OPTIONS.map((option) => t(option.labelKey)),
    formatWeekly: (weekday, time) => t("automations.schedule.weeklyAt", { weekday, time }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1 rounded-md border-0 bg-transparent px-1 text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[120]")}>
        <AutomationTimeScheduleOptions
          schedule={schedule}
          disabled={disabled}
          onScheduleChange={onScheduleChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DailyScheduleSub({
  title,
  schedule,
  onScheduleChange,
}: {
  title: string;
  schedule: DesktopAutomationSchedule;
  onScheduleChange(schedule: DesktopAutomationSchedule): void;
}) {
  const { hour, minute } = resolveDailyTime(schedule);
  const activateDaily = () => onScheduleChange(toDailySchedule(schedule));

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger onSelect={activateDaily} onClick={activateDaily}>
        {title}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="z-[130] p-0">
        <div className="w-56 p-3">
          <ScheduleTimeFields
            hour={hour}
            minute={minute}
            onHourChange={(nextHour) => onScheduleChange({ kind: "daily", hour: nextHour, minute })}
            onMinuteChange={(nextMinute) => onScheduleChange({ kind: "daily", hour, minute: nextMinute })}
          />
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function WeeklyScheduleSub({
  title,
  schedule,
  onScheduleChange,
}: {
  title: string;
  schedule: DesktopAutomationSchedule;
  onScheduleChange(schedule: DesktopAutomationSchedule): void;
}) {
  const { t } = useTranslation();
  const { hour, minute } = resolveDailyTime(schedule);
  const weekday = resolveWeeklyWeekday(schedule);
  const activateWeekly = () => onScheduleChange(toWeeklySchedule(schedule));

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger onSelect={activateWeekly} onClick={activateWeekly}>
        {title}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="z-[130] p-0">
        <div className="w-56 space-y-3 p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t("automations.schedule.weekday")}</p>
            <Select
              value={String(weekday)}
              onValueChange={(value) => {
                onScheduleChange({
                  kind: "weekly",
                  weekday: Number(value) as DesktopAutomationWeekday,
                  hour,
                  minute,
                });
              }}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[140]">
                {WEEKDAY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScheduleTimeFields
            hour={hour}
            minute={minute}
            onHourChange={(nextHour) =>
              onScheduleChange({ kind: "weekly", weekday, hour: nextHour, minute })}
            onMinuteChange={(nextMinute) =>
              onScheduleChange({ kind: "weekly", weekday, hour, minute: nextMinute })}
          />
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ScheduleTimeFields({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number;
  minute: number;
  onHourChange(value: number): void;
  onMinuteChange(value: number): void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("automations.schedule.hour")}</p>
        <Select value={String(hour)} onValueChange={(value) => onHourChange(Number(value))}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[150]">
            {hourOptions().map((option) => (
              <SelectItem key={option} value={String(option)}>
                {String(option).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t("automations.schedule.minute")}</p>
        <Select value={String(minute)} onValueChange={(value) => onMinuteChange(Number(value))}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[150]">
            {minuteOptions().map((option) => (
              <SelectItem key={option} value={String(option)}>
                {String(option).padStart(2, "0")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
