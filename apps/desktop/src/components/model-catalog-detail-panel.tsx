import { type ReactNode, useMemo } from 'react';
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
  children?: ReactNode;
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
    <section className="flex items-baseline justify-between gap-2">
      <span className={density === 'list' ? DESKTOP_OVERLAY_LIST_DETAIL_LABEL : 'text-[11px] text-muted-foreground'}>
        {label}
      </span>
      <span className="text-right leading-5 text-foreground/90">{value}</span>
    </section>
  );
}

export function ModelCatalogDetailPanel({
  model,
  catalogEntry,
  providerLabel,
  density = 'default',
  children,
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
  const hasDetailFields = detailFields.length > 0;
  const hasContentBelowHeader = Boolean(description || children || hasDetailFields);
  const hasFollowingSection = Boolean(children || hasDetailFields);
  const controlsIsLast = !hasDetailFields;
  const sectionPadding = isList ? 'px-2 py-1.5' : 'px-3 py-2.5';
  const sectionPaddingLast = isList ? 'px-2 pt-1.5' : 'px-3 pt-2.5';
  const sectionDivider = 'border-b border-border/40';

  return (
    <div className={cn(isList ? 'flex flex-col' : '-mx-3 flex flex-col')}>
      <div
        className={cn(
          hasContentBelowHeader && (isList ? 'border-b border-border/40' : 'border-b border-border/60'),
          isList ? 'px-2 py-1.5' : hasContentBelowHeader ? 'px-3 pb-3' : 'px-3',
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
      {description ? (
        <div
          className={cn(
            hasFollowingSection ? sectionPadding : sectionPaddingLast,
            hasFollowingSection && sectionDivider,
            'text-xs',
          )}
        >
          <p className="whitespace-pre-wrap leading-5 text-foreground/90">{description}</p>
        </div>
      ) : null}
      {children ? (
        <div
          className={cn(
            controlsIsLast ? sectionPaddingLast : sectionPadding,
            !controlsIsLast && sectionDivider,
          )}
        >
          {children}
        </div>
      ) : null}
      {hasDetailFields ? (
        <div className={cn(sectionPaddingLast, 'space-y-2 text-xs')}>
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
