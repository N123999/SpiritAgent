import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  DeleteHookEntryRequest,
  DesktopHookEventName,
  DesktopHookListItem,
  DesktopHookScope,
  DesktopSnapshot,
  DesktopWorkspaceBinding,
  SaveHookEntryRequest,
} from "@/types";

const HOOK_EVENTS: DesktopHookEventName[] = [
  "sessionStart",
  "sessionEnd",
  "submitPrompt",
  "preToolUse",
  "postToolUse",
  "subagentStart",
  "subagentEnd",
];

const hookCreateScopeOptions: Array<{
  scope: DesktopHookScope;
  labelKey: string;
  hintKey: string;
}> = [
  { scope: "user", labelKey: "settings.skillUserDirShort", hintKey: "settings.hooksUserDirHint" },
  { scope: "workspace", labelKey: "settings.mcpScopeWorkspace", hintKey: "settings.hooksWorkspaceDirHint" },
];

type HooksSettingsPanelProps = {
  snapshot: DesktopSnapshot | null;
  hooksBusy?: boolean;
  workspaceBinding: DesktopWorkspaceBinding;
  onSaveHookEntry(request: SaveHookEntryRequest): void | Promise<void>;
  onDeleteHookEntry(request: DeleteHookEntryRequest): void | Promise<void>;
};

function hookScopeLabel(scope: DesktopHookScope, t: (key: string) => string): string {
  return scope === "user" ? t("settings.skillUserDirShort") : t("settings.mcpScopeWorkspace");
}

export function HooksSettingsPanel({
  snapshot,
  hooksBusy,
  workspaceBinding,
  onSaveHookEntry,
  onDeleteHookEntry,
}: HooksSettingsPanelProps) {
  const { t } = useTranslation();
  const workspaceBindingDisabled = workspaceBinding === "none";
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DesktopHookListItem | null>(null);
  const [createScope, setCreateScope] = useState<DesktopHookScope>(
    workspaceBindingDisabled ? "user" : "workspace",
  );
  const [event, setEvent] = useState<DesktopHookEventName>("preToolUse");
  const [command, setCommand] = useState("hooks/log-hook.sh");
  const [timeout, setTimeoutValue] = useState("30");
  const [matcher, setMatcher] = useState("");
  const [failClosed, setFailClosed] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const items = useMemo(
    () =>
      (snapshot?.hooksList ?? []).filter(
        (item) => !workspaceBindingDisabled || item.scope === "user",
      ),
    [snapshot?.hooksList, workspaceBindingDisabled],
  );

  const availableHookCreateScopeOptions = workspaceBindingDisabled
    ? hookCreateScopeOptions.filter((option) => option.scope === "user")
    : hookCreateScopeOptions;
  const localizedHookCreateScopeOptions = availableHookCreateScopeOptions.map((option) => ({
    ...option,
    label: t(option.labelKey),
    hint: t(option.hintKey),
  }));

  const resetForm = () => {
    setCreateScope(workspaceBindingDisabled ? "user" : "workspace");
    setEvent("preToolUse");
    setCommand("hooks/log-hook.sh");
    setTimeoutValue("30");
    setMatcher("");
    setFailClosed(false);
  };

  async function handleCreate() {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }
    const parsedTimeout = timeout.trim() ? Number(timeout) : undefined;
    if (
      parsedTimeout !== undefined
      && (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0)
    ) {
      setCreateError(t("settings.hooksTimeoutInvalid"));
      return;
    }
    setCreateError(null);
    await onSaveHookEntry({
      scope: createScope,
      event,
      command: trimmedCommand,
      ...(parsedTimeout !== undefined && Number.isFinite(parsedTimeout)
        ? { timeout: parsedTimeout }
        : {}),
      ...(matcher.trim() ? { matcher: matcher.trim() } : {}),
      ...(failClosed ? { failClosed: true } : {}),
    });
    setAddDialogOpen(false);
    resetForm();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t("settings.hooks")}
          </h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t("app.noWorkspaceBindingHint")}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={hooksBusy}
          onClick={() => {
            resetForm();
            setAddDialogOpen(true);
          }}
        >
          {t("settings.hooksAdd")}
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t("settings.hooksEmpty")}
          </p>
        ) : (
          items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{item.event}</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {hookScopeLabel(item.scope, t)}
                    </Badge>
                  </div>
                  <p
                    className="break-all font-mono text-[0.65rem] text-muted-foreground/90"
                    title={item.command}
                  >
                    {item.command}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="shrink-0 self-start sm:self-center"
                  disabled={hooksBusy}
                  onClick={() => setDeleteTarget(item)}
                >
                  {t("common.delete")}
                </Button>
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
            <DialogTitle>{t("settings.deleteHook")}</DialogTitle>
            <DialogDescription>
              {t("settings.deleteHookConfirm", {
                event: deleteTarget?.event ?? "",
                command: deleteTarget?.command ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={hooksBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={hooksBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteHookEntry({
                      scope: target.scope,
                      event: target.event,
                      index: target.index,
                    });
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {hooksBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("common.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("settings.hooksAdd")}</DialogTitle>
            <DialogDescription>{t("settings.addHookDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t("settings.saveLocation")}</Label>
              <div
                role="tablist"
                aria-label={t("settings.saveLocation")}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedHookCreateScopeOptions.map((opt) => (
                  <button
                    key={opt.scope}
                    type="button"
                    role="tab"
                    aria-selected={createScope === opt.scope}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      createScope === opt.scope
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={hooksBusy}
                    title={opt.hint}
                    onClick={() => setCreateScope(opt.scope)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedHookCreateScopeOptions.find((option) => option.scope === createScope)?.hint}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="hook-event">{t("settings.hooksEvent")}</Label>
              <Select value={event} onValueChange={(value) => setEvent(value as DesktopHookEventName)}>
                <SelectTrigger id="hook-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_EVENTS.map((hookEvent) => (
                    <SelectItem key={hookEvent} value={hookEvent}>
                      {hookEvent}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-command">{t("settings.hooksCommand")}</Label>
              <Input
                id="hook-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="hooks/my-hook.sh"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hook-timeout">{t("settings.hooksTimeout")}</Label>
              <Input
                id="hook-timeout"
                value={timeout}
                onChange={(e) => {
                  setTimeoutValue(e.target.value);
                  setCreateError(null);
                }}
                autoComplete="off"
              />
            </div>
            {createError ? (
              <p className="text-xs text-destructive">{createError}</p>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="hook-matcher">{t("settings.hooksMatcher")}</Label>
              <Input
                id="hook-matcher"
                value={matcher}
                onChange={(e) => setMatcher(e.target.value)}
                placeholder="run_shell_command"
                autoComplete="off"
              />
            </div>
            <label htmlFor="hook-fail-closed" className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox
                id="hook-fail-closed"
                checked={failClosed}
                onCheckedChange={(checked) => setFailClosed(checked === true)}
                disabled={hooksBusy}
                className="size-5"
              />
              {t("settings.hooksFailClosed")}
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={hooksBusy || !command.trim()}
              onClick={() => void handleCreate()}
            >
              {hooksBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
