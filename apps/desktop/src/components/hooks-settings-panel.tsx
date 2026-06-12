import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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

type HooksSettingsPanelProps = {
  snapshot: DesktopSnapshot | null;
  hooksBusy?: boolean;
  workspaceBinding: DesktopWorkspaceBinding;
  onSaveHookEntry(request: SaveHookEntryRequest): void | Promise<void>;
  onDeleteHookEntry(request: DeleteHookEntryRequest): void | Promise<void>;
};

export function HooksSettingsPanel({
  snapshot,
  hooksBusy,
  workspaceBinding,
  onSaveHookEntry,
  onDeleteHookEntry,
}: HooksSettingsPanelProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<DesktopHookScope>("user");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [event, setEvent] = useState<DesktopHookEventName>("preToolUse");
  const [command, setCommand] = useState("hooks/log-hook.sh");
  const [timeout, setTimeoutValue] = useState("30");
  const [matcher, setMatcher] = useState("");
  const [failClosed, setFailClosed] = useState(false);

  const hooksList = snapshot?.hooksList ?? [];
  const filtered = useMemo(
    () => hooksList.filter((item) => item.scope === scope),
    [hooksList, scope],
  );

  const configPath =
    scope === "user"
      ? hooksList.find((item) => item.scope === "user")?.configPath
      : hooksList.find((item) => item.scope === "workspace")?.configPath;

  const workspaceScopeDisabled = workspaceBinding === "none";

  async function handleCreate() {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) {
      return;
    }
    const parsedTimeout = timeout.trim() ? Number(timeout) : undefined;
    await onSaveHookEntry({
      scope,
      event,
      command: trimmedCommand,
      ...(parsedTimeout !== undefined && Number.isFinite(parsedTimeout)
        ? { timeout: parsedTimeout }
        : {}),
      ...(matcher.trim() ? { matcher: matcher.trim() } : {}),
      ...(failClosed ? { failClosed: true } : {}),
    });
    setDialogOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="hooks-scope">{t("settings.hooksScope")}</Label>
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as DesktopHookScope)}
          >
            <SelectTrigger id="hooks-scope" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{t("settings.hooksScopeUser")}</SelectItem>
              <SelectItem value="workspace" disabled={workspaceScopeDisabled}>
                {t("settings.hooksScopeWorkspace")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={hooksBusy || (scope === "workspace" && workspaceScopeDisabled)}
          onClick={() => setDialogOpen(true)}
        >
          {hooksBusy ? (
            <LoaderCircle className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 size-4" />
          )}
          {t("settings.hooksAdd")}
        </Button>
      </div>

      {configPath ? (
        <p className="text-xs text-muted-foreground break-all">
          {t("settings.hooksConfigPath")}: {configPath}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">{t("settings.hooksDescription")}</p>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("settings.hooksEmpty")}</p>
        ) : (
          filtered.map((item: DesktopHookListItem) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/40 bg-background/60 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{item.event}</div>
                <div className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {item.command}
                </div>
                {(item.matcher || item.timeout || item.failClosed) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.timeout !== undefined ? `timeout=${item.timeout}s ` : ""}
                    {item.matcher ? `matcher=${item.matcher} ` : ""}
                    {item.failClosed ? "failClosed" : ""}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={hooksBusy}
                onClick={() =>
                  onDeleteHookEntry({
                    scope: item.scope,
                    event: item.event,
                    index: item.index,
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.hooksAdd")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="hook-event">{t("settings.hooksEvent")}</Label>
              <Select value={event} onValueChange={(v) => setEvent(v as DesktopHookEventName)}>
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
            <div className="grid gap-1.5">
              <Label htmlFor="hook-command">{t("settings.hooksCommand")}</Label>
              <Input
                id="hook-command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="hooks/my-hook.sh"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hook-timeout">{t("settings.hooksTimeout")}</Label>
              <Input
                id="hook-timeout"
                value={timeout}
                onChange={(e) => setTimeoutValue(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hook-matcher">{t("settings.hooksMatcher")}</Label>
              <Input
                id="hook-matcher"
                value={matcher}
                onChange={(e) => setMatcher(e.target.value)}
                placeholder="run_shell_command"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="hook-fail-closed"
                checked={failClosed}
                onCheckedChange={(checked) => setFailClosed(checked === true)}
              />
              <Label htmlFor="hook-fail-closed">{t("settings.hooksFailClosed")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={hooksBusy} onClick={() => void handleCreate()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
