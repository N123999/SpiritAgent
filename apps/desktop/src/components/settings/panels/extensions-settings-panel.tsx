import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";

import { formatExtensionInstalledAt, fileToBase64 } from "@/components/settings/formatters";
import type { SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeleteExtensionRequest, DesktopExtensionListItem } from "@/types";

export function ExtensionsSettingsPanel({
  snapshot,
  extensionsBusy,
  onImportExtension,
  onDeleteExtension,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "extensionsBusy"
  | "onImportExtension"
  | "onDeleteExtension"
>) {
  const { t } = useTranslation();
  const [deleteTarget, setDeleteTarget] = useState<DesktopExtensionListItem | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const items = snapshot?.extensionsList ?? [];

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) {
            return;
          }

          void (async () => {
            try {
              const archiveBase64 = await fileToBase64(file);
              await onImportExtension({
                archiveBase64,
                fileName: file.name,
              });
            } catch {
              /* runtimeError */
            }
          })();
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.extensionsTitle')}</h1>
            {snapshot?.extensionsLoading ? (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={extensionsBusy}
          onClick={() => inputRef.current?.click()}
        >
          {t('settings.importZip')}
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noExtensionsInstalled')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {item.version}
                  </Badge>
                  {item.author ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {item.author}
                    </Badge>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                ) : null}
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground/90" title={item.id}>
                  {item.id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.installedAt')}{formatExtensionInstalledAt(item.installedAtUnixMs)}
                  {item.archiveFileName ? ` · ${t('settings.source')}${item.archiveFileName}` : ""}
                </p>
                {item.activationEvents?.length ? (
                  <p className="text-xs text-muted-foreground">
                    activationEvents: {item.activationEvents.join(", ")}
                  </p>
                ) : null}
                {item.desktopCss?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">{t('settings.desktopCss')}</p>
                    {item.desktopCss.map((entry) => (
                      <div
                        key={`${item.id}:desktop-css:${entry.path}`}
                        className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[0.7rem] text-foreground">{entry.path}</code>
                          {entry.media ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              media: {entry.media}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('settings.desktopCssDescription')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.cliHooks?.length ? (
                  <div className="space-y-1 pt-1">
                    <p className="text-xs font-medium text-foreground">{t('settings.cliHooks')}</p>
                    {item.cliHooks.map((hook, index) => (
                      <div
                        key={`${item.id}:cli-hook:${hook.slot}:${index}`}
                        className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="text-[0.7rem] text-foreground">{hook.slot}</code>
                          {hook.variant ? (
                            <Badge variant="outline" className="text-[0.65rem] text-muted-foreground">
                              variant: {hook.variant}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('settings.cliHookDescription')}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 self-start sm:self-center">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={extensionsBusy}
                  onClick={() => setDeleteTarget(item)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))
        )}
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
            <DialogTitle>{t('settings.deleteExtension')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteExtensionConfirm', { name: deleteTarget?.displayName ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={extensionsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={extensionsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteExtension({ id: target.id });
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {extensionsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
