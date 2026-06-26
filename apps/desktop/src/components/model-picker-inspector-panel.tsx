import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  modelReasoningEffortLabel,
  modelReasoningEffortOptions,
} from '@spirit-agent/core/reasoning-effort';
import {
  modelEffortControlLabelKind,
  modelShowsReasoningEffortControl,
  modelSupportsThinkingSwitch,
  resolveModelThinkingEnabled,
} from '@spirit-agent/core/model-thinking-controls';

import { ModelCatalogDetailPanel } from '@/components/model-catalog-detail-panel';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  DESKTOP_OVERLAY_LIST_DETAIL_LABEL,
} from '@/lib/desktop-chrome';
import type {
  DesktopModelReasoningEffort,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from '@/types';

type ModelPickerInspectorPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  density?: 'default' | 'list';
  onReasoningEffortChange: (modelName: string, effort: DesktopModelReasoningEffort) => void;
  onThinkingEnabledChange?: (modelName: string, enabled: boolean) => void | Promise<boolean>;
};

export function ModelPickerInspectorPanel({
  model,
  catalogEntry,
  providerLabel,
  density = 'default',
  onReasoningEffortChange,
  onThinkingEnabledChange,
}: ModelPickerInspectorPanelProps) {
  const { t } = useTranslation();
  const isList = density === 'list';
  const modelContext = {
    ...(model.provider ? { provider: model.provider } : {}),
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    ...(model.transportKind ? { transportKind: model.transportKind } : {}),
  };
  const supportsThinkingSwitch = modelSupportsThinkingSwitch(modelContext);
  const [pendingThinkingEnabled, setPendingThinkingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    setPendingThinkingEnabled(null);
  }, [model.name, model.thinkingEnabled]);
  const thinkingEnabled =
    pendingThinkingEnabled ?? resolveModelThinkingEnabled(model.thinkingEnabled);
  const showReasoningEffort = modelShowsReasoningEffortControl(modelContext, thinkingEnabled);
  const effortOptions = showReasoningEffort ? modelReasoningEffortOptions(modelContext) : [];
  const effortLabelKey =
    modelEffortControlLabelKind(modelContext) === 'effort'
      ? 'app.modelPickerEffort'
      : 'app.modelPickerReasoningEffort';
  const labelClass = isList ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : 'text-xs text-muted-foreground';
  const selectTriggerClass = isList
    ? 'h-7 w-auto border-0 bg-transparent px-0 text-xs shadow-none [&_span]:justify-end'
    : 'h-8 w-auto border-0 bg-transparent px-0 text-xs shadow-none [&_span]:justify-end';

  const modelControls =
    supportsThinkingSwitch || effortOptions.length > 1 ? (
      <div className="space-y-2">
        {supportsThinkingSwitch ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass} htmlFor={`model-thinking-${model.name}`}>
              {t('app.modelPickerThinking')}
            </Label>
            <Switch
              id={`model-thinking-${model.name}`}
              checked={thinkingEnabled}
              onCheckedChange={(checked) => {
                setPendingThinkingEnabled(checked);
                void Promise.resolve(onThinkingEnabledChange?.(model.name, checked)).then(
                  (ok) => {
                    if (ok === false) {
                      setPendingThinkingEnabled(null);
                    }
                  },
                );
              }}
            />
          </div>
        ) : null}
        {effortOptions.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <Label className={labelClass}>{t(effortLabelKey)}</Label>
            <Select
              value={model.reasoningEffort}
              onValueChange={(value) => {
                onReasoningEffortChange(model.name, value as DesktopModelReasoningEffort);
              }}
            >
              <SelectTrigger className={selectTriggerClass}>
                <SelectValue>
                  {modelReasoningEffortLabel(model.reasoningEffort)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="z-[110]">
                {effortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className={isList ? 'flex flex-col' : 'space-y-4'}>
      <ModelCatalogDetailPanel
        model={model}
        catalogEntry={catalogEntry}
        providerLabel={providerLabel}
        density={density}
      >
        {modelControls}
      </ModelCatalogDetailPanel>
    </div>
  );
}
