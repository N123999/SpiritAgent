import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  DESKTOP_OVERLAY_LIST_DETAIL_LABEL,
  DESKTOP_OVERLAY_LIST_ITEM_PRIMARY,
  DESKTOP_OVERLAY_LIST_ITEM_SECONDARY,
} from '@/lib/desktop-chrome';
import { modelCapabilityLabel } from '@/lib/model-capability-label';
import {
  buildModelCatalogDetailFields,
  modelCatalogDisplayTitle,
} from '@/lib/model-catalog-detail';
import { parseModelContextLength } from '@/lib/model-context-length';
import { cn } from '@/lib/utils';
import type { ModelProfileSnapshot, PreviewModelCatalogEntry } from '@/types';

type ModelCatalogDetailPanelProps = {
  model: ModelProfileSnapshot;
  catalogEntry?: PreviewModelCatalogEntry;
  providerLabel: string;
  density?: 'default' | 'list';
};

function ModelCatalogDetailFieldSection({
  label,
  value,
  density = 'default',
}: {
  label: string;
  value: string;
  density?: 'default' | 'list';
}) {
  return (
    <section className={density === 'list' ? 'space-y-1' : 'space-y-1.5'}>
      <p className={density === 'list' ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : 'text-[11px] text-muted-foreground'}>
        {label}
      </p>
      <p className="leading-5 text-foreground/90">{value}</p>
    </section>
  );
}

export function ModelCatalogDetailPanel({
  model,
  catalogEntry,
  providerLabel,
  density = 'default',
}: ModelCatalogDetailPanelProps) {
  const { t } = useTranslation();
  const isList = density === 'list';
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
    <div className={cn(isList ? 'flex flex-col' : '-mx-3 flex flex-col')}>
      <div
        className={cn(
          'border-b border-border/60',
          isList ? 'border-border/40 px-2 py-1.5' : 'px-3 pb-3',
        )}
      >
        <p
          className={cn(
            isList
              ? DESKTOP_OVERLAY_LIST_ITEM_PRIMARY
              : 'text-sm font-medium leading-snug text-foreground',
          )}
        >
          {title}
        </p>
        <p className={cn(isList ? DESKTOP_OVERLAY_LIST_ITEM_SECONDARY : 'mt-1 text-[11px] text-muted-foreground')}>
          {providerLabel}
        </p>
        {capabilities && capabilities.length > 0 ? (
          <div className={cn('flex flex-wrap gap-1.5', isList ? 'mt-1.5' : 'mt-2')}>
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
        <div className={cn(isList ? 'space-y-2 px-2 py-1.5 text-xs' : 'space-y-3 px-3 pt-3 text-xs')}>
          {description ? (
            <p className="whitespace-pre-wrap leading-5 text-foreground/90">{description}</p>
          ) : null}
          {detailFields.map((field) => (
            <ModelCatalogDetailFieldSection
              key={field.id}
              label={field.label}
              value={field.value}
              density={density}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
