import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DesktopAutomationListItem, DesktopSnapshot } from "@/types";
import { cn } from "@/lib/utils";

type AutomationsViewProps = {
  snapshot: DesktopSnapshot | null;
  apiReady: boolean;
  busyAction: string;
  onCreateAutomation: () => void;
  onOpenAutomation: (automationId: string) => void;
  onDeleteAutomation?: (automationId: string) => void | Promise<void>;
};

export function AutomationsView({
  snapshot,
  apiReady,
  busyAction,
  onCreateAutomation,
  onOpenAutomation,
  onDeleteAutomation,
}: AutomationsViewProps) {
  const { t } = useTranslation();
  const items = snapshot?.automationsList ?? [];
  const automationBusy = busyAction === "automation";
  const canDeleteAutomation = Boolean(onDeleteAutomation) && apiReady && !automationBusy;

  const [contextMenuAutomation, setContextMenuAutomation] = useState<DesktopAutomationListItem | null>(null);
  const contextMenuAutomationRef = useRef<DesktopAutomationListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesktopAutomationListItem | null>(null);

  const automationById = useMemo(() => {
    const map = new Map<string, DesktopAutomationListItem>();
    for (const item of items) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  const handleAutomationContextMenuCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const row = (event.target as HTMLElement).closest("[data-automation-id]");
      if (!row) {
        event.preventDefault();
        return;
      }
      const automationId = row.getAttribute("data-automation-id");
      const automation = automationId ? automationById.get(automationId) : undefined;
      if (!automation) {
        event.preventDefault();
        return;
      }
      contextMenuAutomationRef.current = automation;
      setContextMenuAutomation(automation);
    },
    [automationById],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      contextMenuAutomationRef.current = null;
      setContextMenuAutomation(null);
    }
  }, []);

  const handleContextMenuDelete = useCallback((automation: DesktopAutomationListItem) => {
    contextMenuAutomationRef.current = null;
    setContextMenuAutomation(null);
    setDeleteTarget(automation);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col px-4 py-8">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                {t("automations.title")}
              </h1>
              <p className="text-sm text-muted-foreground">{t("automations.subtitle")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled
                title={t("automations.generateComingSoon")}
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
                {t("automations.generate")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={!apiReady || automationBusy}
                onClick={onCreateAutomation}
              >
                {t("automations.create")}
              </Button>
            </div>
          </div>

          <AutomationListNav
            canDeleteAutomation={canDeleteAutomation}
            contextMenuAutomation={contextMenuAutomation}
            contextMenuAutomationRef={contextMenuAutomationRef}
            deleteAutomationBusy={automationBusy}
            onAutomationContextMenuCapture={handleAutomationContextMenuCapture}
            onContextMenuOpenChange={handleContextMenuOpenChange}
            onRequestDelete={handleContextMenuDelete}
          >
            <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("automations.empty")}
                </p>
              ) : (
                items.map((item) => (
                  <AutomationListRow
                    key={item.id}
                    item={item}
                    onOpen={() => onOpenAutomation(item.id)}
                  />
                ))
              )}
            </div>
          </AutomationListNav>
        </div>
      </div>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("automations.deleteAutomation")}</DialogTitle>
            <DialogDescription>
              {t("automations.deleteAutomationConfirm", { name: deleteTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={automationBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={automationBusy || !deleteTarget || !onDeleteAutomation}
              onClick={() => {
                const target = deleteTarget;
                if (!target || !onDeleteAutomation) {
                  return;
                }
                void (async () => {
                  await onDeleteAutomation(target.id);
                  setDeleteTarget(null);
                })();
              }}
            >
              {automationBusy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AutomationListNavProps = {
  canDeleteAutomation: boolean;
  contextMenuAutomation: DesktopAutomationListItem | null;
  contextMenuAutomationRef: RefObject<DesktopAutomationListItem | null>;
  deleteAutomationBusy?: boolean;
  onAutomationContextMenuCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenuOpenChange(open: boolean): void;
  onRequestDelete(automation: DesktopAutomationListItem): void;
  children: ReactNode;
};

function AutomationListNav({
  canDeleteAutomation,
  contextMenuAutomation,
  contextMenuAutomationRef,
  deleteAutomationBusy,
  onAutomationContextMenuCapture,
  onContextMenuOpenChange,
  onRequestDelete,
  children,
}: AutomationListNavProps) {
  const { t } = useTranslation();

  const list = (
    <div
      onContextMenuCapture={canDeleteAutomation ? onAutomationContextMenuCapture : undefined}
    >
      {children}
    </div>
  );

  if (!canDeleteAutomation) {
    return list;
  }

  return (
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger asChild>{list}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t("automations.listActions")}>
        <ContextMenuItem
          variant="destructive"
          disabled={deleteAutomationBusy}
          onSelect={() => {
            const automation = contextMenuAutomationRef.current ?? contextMenuAutomation;
            if (automation) {
              onRequestDelete(automation);
            }
          }}
        >
          <Trash2 aria-hidden />
          {t("automations.deleteAutomation")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AutomationListRow({
  item,
  onOpen,
}: {
  item: DesktopAutomationListItem;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      data-automation-id={item.id}
      onClick={onOpen}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-4 text-left",
        "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{item.title}</span>
        {!item.enabled ? (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t("automations.disabled")}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{item.scheduleLabel}</p>
    </button>
  );
}
