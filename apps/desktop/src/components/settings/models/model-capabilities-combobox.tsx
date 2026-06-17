import { useTranslation } from "react-i18next";
import { ChevronsUpDown, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DESKTOP_FORM_FIELD_TRIGGER_INNER,
  DESKTOP_FORM_INPUT_SHELL,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { DesktopModelCapability } from "@/types";
import { modelCapabilityOptions, normalizeModelCapabilitySelection } from "./model-defaults";

export function ModelCapabilitiesCombobox({
  value,
  disabled,
  onChange,
}: {
  value: DesktopModelCapability[];
  disabled?: boolean;
  onChange: (value: DesktopModelCapability[]) => void;
}) {
  const { t } = useTranslation();
  const selected = normalizeModelCapabilitySelection(value);
  const selectedOptions = modelCapabilityOptions.filter((option) =>
    selected.includes(option.value),
  );
  const selectedSet = new Set(selected);

  const toggleCapability = (capability: DesktopModelCapability, checked: boolean) => {
    const next = checked
      ? [...selected, capability]
      : selected.filter((item) => item !== capability);
    onChange(normalizeModelCapabilitySelection(next));
  };

  return (
    <DropdownMenu>
      <div className={DESKTOP_FORM_INPUT_SHELL}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              DESKTOP_FORM_FIELD_TRIGGER_INNER,
              "flex min-w-0 items-center justify-between gap-2 py-1 pr-2 pl-1.5 text-sm transition-colors outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selectedOptions.length > 0 ? (
              selectedOptions.map((option) => {
                const label = t(option.labelKey, { defaultValue: option.label });
                return (
                  <span
                    key={option.value}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.5 text-xs text-foreground"
                  >
                    <span className="truncate">{label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={t('settings.removeCapability', { label })}
                    className="rounded-sm text-muted-foreground hover:text-foreground"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleCapability(option.value, false);
                    }}
                  >
                    <X className="size-3" aria-hidden />
                  </span>
                  </span>
                );
              })
            ) : (
              <span className="px-1 text-muted-foreground">{t('settings.selectCapability')}</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {modelCapabilityOptions.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selectedSet.has(option.value)}
            onCheckedChange={(checked) => toggleCapability(option.value, checked)}
            onSelect={(event) => event.preventDefault()}
            className="items-start gap-2 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{t(option.labelKey, { defaultValue: option.label })}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t(option.summaryKey)}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
