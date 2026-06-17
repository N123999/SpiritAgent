import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import {
  HoverDetailTooltip,
  useHoverDetailTooltipContext,
} from "@/components/ui/hover-detail-tooltip";
import { modelSettingsRowAriaLabel } from "@/lib/model-catalog-detail";
import { modelCapabilityLabel } from "@/lib/model-capability-label";
import { cn } from "@/lib/utils";
import type { SettingsModelProfile } from "./model-defaults";

export function ModelSettingsRowButton({
  model,
  displayTitle,
  isActive,
  isImageDefault,
  isLightweightDefault,
  defaultActionLabel,
  disabled,
  isHighlighted = false,
  showNativeTitle = true,
  onPointerEnter,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  isActive: boolean;
  isImageDefault: boolean;
  isLightweightDefault: boolean;
  defaultActionLabel: string;
  disabled: boolean;
  isHighlighted?: boolean;
  /** 有 HoverDetailTooltip 时不显示浏览器 title，避免盖住详情 Popover。 */
  showNativeTitle?: boolean;
  onPointerEnter?: () => void;
  onDefaultAction: () => void;
}) {
  const { t } = useTranslation();
  const rowAriaLabel = modelSettingsRowAriaLabel(defaultActionLabel, model.name, displayTitle);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full appearance-none flex-col gap-3 bg-transparent px-4 py-3 text-left outline-none enabled:cursor-pointer enabled:hover:bg-foreground/[0.06] dark:enabled:hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        isHighlighted && "bg-muted/30",
      )}
      disabled={disabled}
      title={showNativeTitle ? rowAriaLabel : undefined}
      aria-label={rowAriaLabel}
      onPointerEnter={onPointerEnter}
      onClick={onDefaultAction}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{displayTitle}</span>
          {isActive ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentInference")}
            </Badge>
          ) : null}
          {isImageDefault ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentImageGen")}
            </Badge>
          ) : null}
          {isLightweightDefault ? (
            <Badge variant="secondary" className="text-muted-foreground">
              {t("settings.currentLightweightChat")}
            </Badge>
          ) : null}
          {model.capabilities?.map((capability) => (
            <Badge key={capability} variant="outline" className="text-muted-foreground">
              {modelCapabilityLabel(capability)}
            </Badge>
          ))}
        </div>
      </div>
    </button>
  );
}

export function ModelSettingsRowWithHover({
  model,
  displayTitle,
  isActive,
  isImageDefault,
  isLightweightDefault,
  defaultActionLabel,
  disabled,
  onDefaultAction,
}: {
  model: SettingsModelProfile;
  displayTitle: string;
  isActive: boolean;
  isImageDefault: boolean;
  isLightweightDefault: boolean;
  defaultActionLabel: string;
  disabled: boolean;
  onDefaultAction: () => void;
}) {
  const { getTriggerProps } = useHoverDetailTooltipContext<SettingsModelProfile>();
  const { onPointerEnter, isHighlighted } = getTriggerProps(model);

  return (
    <HoverDetailTooltip.Anchor itemId={model.name}>
      <ModelSettingsRowButton
        model={model}
        displayTitle={displayTitle}
        isActive={isActive}
        isImageDefault={isImageDefault}
        isLightweightDefault={isLightweightDefault}
        defaultActionLabel={defaultActionLabel}
        disabled={disabled}
        isHighlighted={isHighlighted}
        showNativeTitle={false}
        onPointerEnter={onPointerEnter}
        onDefaultAction={onDefaultAction}
      />
    </HoverDetailTooltip.Anchor>
  );
}
