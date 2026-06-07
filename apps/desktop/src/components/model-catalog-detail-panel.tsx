import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { modelCapabilityLabel } from '@/lib/model-capability-label';
import {
  buildModelCatalogDetailFields,
  modelCatalogDisplayTitle,
} from '@/lib/model-catalog-detail';
import { parseModelContextLength } from '@/lib/model-context-length';
import type { ModelProfileSnapshot, PreviewModelCatalogEntry } from '@/types';

type ModelCatalogDetailPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
};

function ModelCatalogDetailFieldSection({ label, value }: { label: string; value: string }) {
  return (
    <section className="space-y-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="leading-5 text-foreground/90">{value}</p>
    </section>
  );
}

export function ModelCatalogDetailPanel({
  model,
  catalogEntry,
  providerLabel,
}: ModelCatalogDetailPanelProps) {
  const { t } = useTranslation();
  const title = modelCatalogDisplayTitle(model, catalogEntry);
  const capabilities = model.capabilities ?? catalogEntry?.capabilities;
  const contextLength =
    parseModelContextLength(model.contextLength)
    ?? parseModelContextLength(catalogEntry?.contextLength);
  const description = catalogEntry?.description?.trim() ?? '';
  const detailFields = useMemo(
    () =>
      buildModelCatalogDetailFields({
        ...(contextLength !== undefined ? { contextLength } : {}),
        pricing: catalogEntry?.pricing,
        t,
      }),
    [catalogEntry?.pricing, contextLength, t],
  );
  const hasBody = Boolean(description || detailFields.length > 0);

  return (
    <div className="-mx-3 flex flex-col">
      <div className="border-b border-border/60 px-3 pb-3">
        <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{providerLabel}</p>
        {capabilities && capabilities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <Badge
                key={capability}
                variant="secondary"
                className="text-[10px] text-secondary-foreground"
              >
                {modelCapabilityLabel(capability)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {hasBody ? (
        <div className="space-y-3 px-3 pt-3 text-xs">
          {description ? (
            <p className="whitespace-pre-wrap leading-5 text-foreground/90">{description}</p>
          ) : null}
          {detailFields.map((field) => (
            <ModelCatalogDetailFieldSection key={field.id} label={field.label} value={field.value} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
