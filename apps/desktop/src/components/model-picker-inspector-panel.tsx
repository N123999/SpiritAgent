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
import type {
  DesktopModelReasoningEffort,
  ModelProfileSnapshot,
  PreviewModelCatalogEntry,
} from '@/types';

type ModelPickerInspectorPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  onReasoningEffortChange: (modelName: string, effort: DesktopModelReasoningEffort) => void;
};

export function ModelPickerInspectorPanel({
  model,
  catalogEntry,
  providerLabel,
  onReasoningEffortChange,
}: ModelPickerInspectorPanelProps) {
  const { t } = useTranslation();
  const effortOptions = modelReasoningEffortOptions({
    provider: model.provider,
    model: model.name,
    ...(model.supportedReasoningEfforts !== undefined
      ? { supportedEfforts: model.supportedReasoningEfforts }
      : {}),
    transportKind: model.transportKind,
  });

  return (
    <div className="space-y-4">
      <ModelCatalogDetailPanel
        model={model}
        catalogEntry={catalogEntry}
        providerLabel={providerLabel}
      />
      {effortOptions.length > 1 ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t('app.modelPickerReasoningEffort')}
          </Label>
          <Select
            value={model.reasoningEffort}
            onValueChange={(value) => {
              onReasoningEffortChange(model.name, value as DesktopModelReasoningEffort);
            }}
          >
            <SelectTrigger className="h-8 w-full border-input/60 bg-transparent text-xs shadow-none">
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
