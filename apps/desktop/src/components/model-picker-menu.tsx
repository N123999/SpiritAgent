import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

import { ModelPickerInspectorPanel } from "@/components/model-picker-inspector-panel";
import {
  FilteredOverlayMenu,
  FilteredOverlayMenuTrigger,
} from "@/components/ui/filtered-overlay-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipItem,
  TooltipTrigger,
  useOptionalTooltipStableActions,
} from "@/components/ui/tooltip";
import {
  DESKTOP_OVERLAY_LIST_DETAIL_SURFACE,
  DESKTOP_OVERLAY_LIST_DETAIL_WIDTH,
  DESKTOP_OVERLAY_LIST_GROUP_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { isMacDesktopPlatform, modSlashShortcutKbdKeys } from "@/lib/desktop-shell";
import {
  notifyModelPickerFocused,
  registerModelPicker,
  unregisterModelPicker,
} from "@/lib/model-picker-shortcut-bridge";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelDisplayTitleFromMap,
} from "@/lib/model-catalog-detail";
import { modelReasoningEffortLabel } from "@spirit-agent/core/reasoning-effort";
import { groupModelsForPicker } from "@/lib/model-picker-groups";
import type { DesktopModelReasoningEffort, DesktopSnapshot } from "@/types";
import { cn } from "@/lib/utils";

type ModelPickerItem = DesktopSnapshot["config"]["models"][number];

const MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS = 300;

function ModelPickerShortcutKbd() {
  const keys = modSlashShortcutKbdKeys();

  return (
    <KbdGroup>
      {isMacDesktopPlatform() ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <>
          <Kbd>Ctrl</Kbd>
          <span>+</span>
          <Kbd>/</Kbd>
        </>
      )}
    </KbdGroup>
  );
}

const ModelPickerRow = memo(function ModelPickerRow({
  model,
  displayTitle,
  isActive,
  onSelectModel,
}: {
  model: ModelPickerItem;
  displayTitle: string;
  isActive: boolean;
  onSelectModel: (modelName: string) => void;
}) {
  return (
    <TooltipItem item={model}>
      <DropdownMenuItem
        className={cn(isActive && "bg-accent/40")}
        onSelect={() => {
          onSelectModel(model.name);
        }}
      >
        <span className={cn(DESKTOP_OVERLAY_LIST_ITEM_PRIMARY, "min-w-0 truncate")}>
          {displayTitle}
        </span>
      </DropdownMenuItem>
    </TooltipItem>
  );
});

export type ModelPickerMenuProps = {
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModelName: string;
  activeReasoningEffort?: DesktopModelReasoningEffort;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect?(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  triggerClassName?: string;
  menuContentClassName?: string;
};

export function ModelPickerMenu({
  models,
  catalogHints,
  activeModelName,
  activeReasoningEffort,
  disabled,
  open: openProp,
  onOpenChange,
  onModelSelect,
  onModelReasoningEffortSelect,
  triggerClassName,
  menuContentClassName,
}: ModelPickerMenuProps) {
  const { t } = useTranslation();
  const tooltipActions = useOptionalTooltipStableActions();
  const [internalOpen, setInternalOpen] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const registrationIdRef = useRef<string | null>(null);
  const reactId = useId();

  const isControlled = openProp !== undefined;
  const modelMenuOpen = isControlled ? openProp : internalOpen;
  const suppressTooltip = modelMenuOpen || disabled;
  const setModelMenuOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const activeModelProfile = models.find((model) => model.name === activeModelName);
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(models, catalogHints),
    [catalogHints, models],
  );
  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, catalogHints),
    [catalogHints, models],
  );
  const modelGroups = useMemo(
    () => groupModelsForPicker(models, catalogHints),
    [catalogHints, models],
  );
  const filteredModelGroups = useMemo(() => {
    const query = modelFilter.trim().toLowerCase();
    if (!query) {
      return modelGroups;
    }
    return modelGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((model) => {
          const title = modelDisplayTitleFromMap(model.name, displayTitleByModelName).toLowerCase();
          return title.includes(query) || model.name.toLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [displayTitleByModelName, modelFilter, modelGroups]);

  const handleModelFilterChange = useCallback((next: string) => {
    if (next !== modelFilter) {
      flushSync(() => {
        tooltipActions?.dismissActiveItem();
      });
    }
    setModelFilter(next);
  }, [modelFilter, tooltipActions]);

  const dismissOpenListTooltip = useCallback(() => {
    flushSync(() => {
      tooltipActions?.dismissActiveItem();
    });
  }, [tooltipActions]);

  const handleSelectModel = useCallback((name: string) => {
    dismissOpenListTooltip();
    onModelSelect(name);
    setModelFilter("");
    setModelMenuOpen(false);
  }, [dismissOpenListTooltip, onModelSelect, setModelMenuOpen]);

  const activeModelSummary = activeModelProfile
    ? formatModelPickerLabel(
        modelDisplayTitleFromMap(activeModelProfile.name, displayTitleByModelName),
        activeReasoningEffort ?? activeModelProfile.reasoningEffort,
      )
    : activeModelName;

  useEffect(() => {
    const id = registerModelPicker({
      open: () => setModelMenuOpen(true),
      getRoot: () => rootRef.current,
    });
    registrationIdRef.current = id;
    return () => {
      unregisterModelPicker(id);
      registrationIdRef.current = null;
    };
  }, [setModelMenuOpen]);

  const handleTriggerFocus = useCallback(() => {
    const id = registrationIdRef.current;
    if (id) {
      notifyModelPickerFocused(id);
    }
  }, []);

  if (models.length === 0) {
    return (
      <span
        data-composer-chrome-static=""
        className="cursor-default px-1 text-xs text-muted-foreground"
      >
        {t("app.noModelsAvailable")}
      </span>
    );
  }

  return (
    <div ref={rootRef} data-model-picker-root data-model-picker-id={reactId} className="min-w-0">
      <FilteredOverlayMenu
        variant="filtered-list"
        open={modelMenuOpen}
        onOpenChange={(open) => {
          if (!open) {
            dismissOpenListTooltip();
          }
          setModelMenuOpen(open);
          if (!open) {
            setModelFilter("");
          }
        }}
        filterValue={modelFilter}
        onFilterChange={handleModelFilterChange}
        filterPlaceholder={t("app.filterModels")}
        trigger={
          <Tooltip
            open={suppressTooltip ? false : undefined}
            delayDuration={MODEL_PICKER_TOOLTIP_SHOW_DELAY_MS}
            disableHoverableContent
          >
            <TooltipTrigger asChild>
              <FilteredOverlayMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("app.selectModel")}
                  disabled={disabled}
                  onFocus={handleTriggerFocus}
                  className={cn(
                    "inline-flex h-7 min-w-0 max-w-full items-center gap-0.5 rounded-md border-0 bg-transparent px-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50",
                    instantHoverMotionClass,
                    triggerClassName,
                  )}
                >
                  <span className="min-w-0 truncate">
                    {activeModelSummary}
                  </span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground/80" aria-hidden />
                </button>
              </FilteredOverlayMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {t("app.selectModel")} <ModelPickerShortcutKbd />
            </TooltipContent>
          </Tooltip>
        }
      >
        {filteredModelGroups.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t("app.noMatches")}</p>
        ) : null}
        <Tooltip<ModelPickerItem> getItemId={(model) => model.name} delayDuration={0}>
          <Tooltip.Zone>
            {filteredModelGroups.length === 0
              ? null
              : filteredModelGroups.map((group) => (
                  <div key={group.provider} className="mb-2 last:mb-0">
                    <div className={DESKTOP_OVERLAY_LIST_GROUP_LABEL}>
                      {t(group.labelKey, { defaultValue: group.fallbackLabel })}
                    </div>
                    {group.items.map((model) => {
                      const displayTitle = modelDisplayTitleFromMap(model.name, displayTitleByModelName);
                      return (
                        <ModelPickerRow
                          key={`${group.provider}:${model.name}`}
                          model={model}
                          displayTitle={displayTitle}
                          isActive={activeModelProfile?.name === model.name}
                          onSelectModel={handleSelectModel}
                        />
                      );
                    })}
                  </div>
                ))}
          </Tooltip.Zone>
          <TooltipContent
            appearance="detail"
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={16}
            className={cn(
              "z-[200]",
              DESKTOP_OVERLAY_LIST_DETAIL_SURFACE,
              DESKTOP_OVERLAY_LIST_DETAIL_WIDTH,
              menuContentClassName,
            )}
          >
            {(activeItem) => {
              const model = activeItem as ModelPickerItem | null;
              if (!model) {
                return null;
              }
              const group = filteredModelGroups.find((entry) =>
                entry.items.some((item) => item.name === model.name),
              );
              const providerLabel = group
                ? t(group.labelKey, { defaultValue: group.fallbackLabel })
                : model.provider ?? model.name;

              return (
                <ModelPickerInspectorPanel
                  model={model}
                  catalogEntry={catalogDetailByModelName.get(model.name)}
                  providerLabel={providerLabel}
                  density="list"
                  onReasoningEffortChange={(modelName, effort) => {
                    onModelReasoningEffortSelect?.(modelName, effort);
                    dismissOpenListTooltip();
                    onModelSelect(modelName);
                    setModelFilter("");
                    setModelMenuOpen(false);
                  }}
                />
              );
            }}
          </TooltipContent>
        </Tooltip>
      </FilteredOverlayMenu>
    </div>
  );
}

function formatModelPickerLabel(name: string, reasoningEffort: DesktopModelReasoningEffort): string {
  return `${name} · ${modelReasoningEffortLabel(reasoningEffort)}`;
}
