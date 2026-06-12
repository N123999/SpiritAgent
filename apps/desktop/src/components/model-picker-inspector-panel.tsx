import { useTranslation } from 'react-i18next';

import {
  modelReasoningEffortLabel,
  modelReasoningEffortOptions,
} from '@spirit-agent/core/reasoning-effort';

import { ModelCatalogDetailPanel } from '@/components/model-catalog-detail-panel';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
};

export function ModelPickerInspectorPanel({
  model,
  catalogEntry,
  providerLabel,
  density = 'default',
  onReasoningEffortChange,
}: ModelPickerInspectorPanelProps) {
  const { t } = useTranslation();
  const isList = density === 'list';
  const effortOptions = modelReasoningEffortOptions({
    provider: model.provider,
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    transportKind: model.transportKind,
  });

  return (
    <div className={isList ? 'flex flex-col' : 'space-y-4'}>
      <ModelCatalogDetailPanel
        model={model}
        catalogEntry={catalogEntry}
        providerLabel={providerLabel}
        density={density}
      />
      {effortOptions.length > 1 ? (
        <div
          className={
            isList
              ? 'space-y-1 border-t border-border/40 px-2 py-1.5'
              : 'space-y-1.5'
          }
        >
          <Label className={isList ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : 'text-xs text-muted-foreground'}>
            {t('app.modelPickerReasoningEffort')}
          </Label>
          <Select
            value={model.reasoningEffort}
            onValueChange={(value) => {
              onReasoningEffortChange(model.name, value as DesktopModelReasoningEffort);
            }}
          >
            <SelectTrigger
              className={
                isList
                  ? 'h-7 w-full rounded-md border border-input/60 bg-transparent px-2.5 text-xs shadow-none'
                  : 'h-8 w-full border-input/60 bg-transparent text-xs shadow-none'
              }
            >
              <SelectValue>{modelReasoningEffortLabel(model.reasoningEffort)}</SelectValue>
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
  );
}
