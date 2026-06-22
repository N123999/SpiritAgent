import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";

import type { SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import type {
  DeleteMcpServerRequest,
  DesktopMcpCapabilityToggles,
  DesktopMcpScope,
  DesktopMcpServerListItem,
  DesktopMcpTransportType,
} from "@/types";

const defaultMcpCapabilities: DesktopMcpCapabilityToggles = {
  tools: true,
  resources: true,
  prompts: true,
};

function mcpTransportTypeLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "HTTP" : "Stdio";
}

function mcpMetadataLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "Headers" : i18n.t('settings.envVars');
}

function mcpEndpointLabel(type: DesktopMcpTransportType): string {
  return type === "http" ? "URL" : i18n.t('settings.command');
}

function mcpEndpointPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? i18n.t('settings.mcpUrlExample')
    : i18n.t('settings.mcpCommandExample');
}

function mcpMetadataPlaceholder(type: DesktopMcpTransportType): string {
  return type === "http"
    ? "Authorization: Bearer ${env:GITHUB_TOKEN}; X-Client: spirit-agent"
    : "PATH=C:/Tools; NODE_ENV=production";
}

function mcpCapabilitiesLabel(item: DesktopMcpServerListItem): string {
  const enabled: string[] = [];
  if (item.capabilities.tools) {
    enabled.push("tools");
  }
  if (item.capabilities.resources) {
    enabled.push("resources");
  }
  if (item.capabilities.prompts) {
    enabled.push("prompts");
  }
  return enabled.length > 0 ? enabled.join(" / ") : "none";
}

function formatMcpMetadata(metadata: Record<string, string>, type: DesktopMcpTransportType): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return "";
  }
  return entries
    .map(([key, value]) => (type === "http" ? `${key}: ${value}` : `${key}=${value}`))
    .join("; ");
}

type McpServerRuntimeBadgeState = "loading" | "ready" | "error" | "disabled";

type McpServerRuntimeInfo = {
  state: McpServerRuntimeBadgeState;
  counts?: {
    tools: number;
    resources: number;
    prompts: number;
  };
};

function mcpCountsSummary(runtime?: McpServerRuntimeInfo): string {
  const tools = runtime?.state === "ready" ? String(runtime.counts?.tools ?? 0) : "-";
  const resources = runtime?.state === "ready" ? String(runtime.counts?.resources ?? 0) : "-";
  const prompts = runtime?.state === "ready" ? String(runtime.counts?.prompts ?? 0) : "-";
  return i18n.t('settings.mcpCountsSummary', { tools, resources, prompts });
}

function McpRuntimeBadge({ state }: { state: McpServerRuntimeBadgeState }) {
  if (state === "ready") {
    return <Badge>{i18n.t('settings.active')}</Badge>;
  }

  if (state === "error") {
    return <Badge variant="destructive">{i18n.t('settings.failed')}</Badge>;
  }

  if (state === "disabled") {
    return <Badge variant="outline">{i18n.t('settings.disabled')}</Badge>;
  }

  return (
    <Badge variant="outline" className="gap-1.5">
      <LoaderCircle className="size-3 animate-spin" aria-hidden />
      {i18n.t('common.loading')}
    </Badge>
  );
}



const mcpCreateScopeOptions: Array<{
  scope: DesktopMcpScope;
  labelKey: string;
  hintKey: string;
}> = [
  { scope: "user", labelKey: "settings.skillUserDirShort", hintKey: "settings.mcpUserDirHint" },
  { scope: "workspace", labelKey: "settings.mcpScopeWorkspace", hintKey: "settings.mcpWorkspaceSpiritHint" },
];

export function McpsSettingsPanel({
  snapshot,
  mcpsBusy,
  onAddMcpServer,
  onDeleteMcpServer,
  onInspectMcpServer,
}: Pick<
  SettingsViewProps,
  "snapshot" | "mcpsBusy" | "onAddMcpServer" | "onDeleteMcpServer" | "onInspectMcpServer"
>) {
  const { t } = useTranslation();
  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteMcpServerRequest | null>(null);
  const [createScope, setCreateScope] = useState<DesktopMcpScope>(
    workspaceBindingDisabled ? "user" : "workspace",
  );
  const [transportType, setTransportType] = useState<DesktopMcpTransportType>("stdio");
  const [newName, setNewName] = useState("");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newMetadata, setNewMetadata] = useState("");
  const [capabilities, setCapabilities] = useState<DesktopMcpCapabilityToggles>(defaultMcpCapabilities);
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, McpServerRuntimeInfo>>({});

  const items = snapshot?.mcpServers ?? [];
  const availableMcpCreateScopeOptions = workspaceBindingDisabled
    ? mcpCreateScopeOptions.filter((option) => option.scope === "user")
    : mcpCreateScopeOptions;
  const localizedMcpCreateScopeOptions = availableMcpCreateScopeOptions.map((option) => ({
    ...option,
    label: t(option.labelKey),
    hint: t(option.hintKey),
  }));

  useEffect(() => {
    let cancelled = false;
    const keys = new Set(items.map((item) => `${item.scope}:${item.name}`));

    setRuntimeInfo((current) => {
      const next: Record<string, McpServerRuntimeInfo> = {};
      for (const item of items) {
        const key = `${item.scope}:${item.name}`;
        next[key] = item.enabled
          ? { state: "loading" }
          : { state: "disabled" };
      }
      for (const [key, info] of Object.entries(current)) {
        if (keys.has(key) && next[key]?.state === "disabled") {
          next[key] = info;
        }
      }
      return next;
    });

    void Promise.all(
      items.map(async (item) => {
        if (!item.enabled) {
          return;
        }
        const key = `${item.scope}:${item.name}`;

        try {
          const inspection = await onInspectMcpServer(item.name);
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "ready",
              counts: {
                tools: inspection.toolsCount,
                resources: inspection.resourcesCount,
                prompts: inspection.promptsCount,
              },
            },
          }));
        } catch {
          if (cancelled) {
            return;
          }
          setRuntimeInfo((current) => ({
            ...current,
            [key]: {
              state: "error",
            },
          }));
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [items, onInspectMcpServer]);

  const resetForm = () => {
    setCreateScope(workspaceBindingDisabled ? "user" : "workspace");
    setTransportType("stdio");
    setNewName("");
    setNewEndpoint("");
    setNewMetadata("");
    setCapabilities(defaultMcpCapabilities);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">MCPs</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t('app.noWorkspaceBindingHint')}</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          onClick={() => {
            resetForm();
            setAddDialogOpen(true);
          }}
          disabled={mcpsBusy}
        >
          {t('settings.addMcp')}
        </Button>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noMcpsConfigured')}</p>
        ) : (
          items.map((item) => {
            const runtimeKey = `${item.scope}:${item.name}`;
            return (
            <div
              key={runtimeKey}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.displayName}</span>
                  <McpRuntimeBadge state={runtimeInfo[runtimeKey]?.state ?? (item.enabled ? "loading" : "disabled")} />
                  <Badge variant="outline" className="text-muted-foreground">
                    {item.scope === "user" ? t('settings.skillUserDirShort') : t('settings.mcpScopeWorkspace')}
                  </Badge>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {mcpTransportTypeLabel(item.transport.type)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t('settings.mcpDisabled')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.transport.summary}</p>
                <p className="text-xs text-muted-foreground">{mcpCountsSummary(runtimeInfo[runtimeKey])}</p>
                {Object.keys(item.transport.metadata).length > 0 ? (
                  <p
                    className="truncate font-mono text-[0.65rem] text-muted-foreground/90"
                    title={formatMcpMetadata(item.transport.metadata, item.transport.type)}
                  >
                    {formatMcpMetadata(item.transport.metadata, item.transport.type)}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={mcpsBusy}
                onClick={() => setDeleteTarget({ name: item.name, scope: item.scope })}
              >
                {t('common.delete')}
              </Button>
            </div>
            );
          })
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
            <DialogTitle>{t('settings.deleteMcp')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteMcpConfirm', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={mcpsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={mcpsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteMcpServer(target);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {mcpsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
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
            <DialogTitle>{t('settings.addMcp')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t('settings.saveLocation')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.saveLocation')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedMcpCreateScopeOptions.map((opt) => (
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
                    disabled={mcpsBusy}
                    title={opt.hint}
                    onClick={() => setCreateScope(opt.scope)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedMcpCreateScopeOptions.find((o) => o.scope === createScope)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>{t('settings.transportType')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.transportType')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {(["stdio", "http"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={transportType === value}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      transportType === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={mcpsBusy}
                    onClick={() => setTransportType(value)}
                  >
                    {mcpTransportTypeLabel(value)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-name">{t('settings.name')}</Label>
              <DesktopFormInput
                id="new-mcp-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={t('settings.mcpNamePlaceholder')}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-endpoint">{mcpEndpointLabel(transportType)}</Label>
              <DesktopFormInput
                id="new-mcp-endpoint"
                value={newEndpoint}
                onChange={(event) => setNewEndpoint(event.target.value)}
                placeholder={mcpEndpointPlaceholder(transportType)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-mcp-metadata">{mcpMetadataLabel(transportType)}</Label>
              <DesktopFormTextarea
                id="new-mcp-metadata"
                value={newMetadata}
                onChange={(event) => setNewMetadata(event.target.value)}
                placeholder={mcpMetadataPlaceholder(transportType)}
                className="min-h-24"
              />
            </div>

            <div className="grid gap-2">
              <Label>Capabilities</Label>
              <div className="grid gap-2 rounded-lg border border-border/40 bg-muted/15 p-3">
                {(["tools", "resources", "prompts"] as const).map((key) => (
                  <label key={key} className="flex items-center justify-between gap-3 text-sm text-foreground">
                    <span>{key}</span>
                    <Checkbox
                      checked={capabilities[key]}
                      onCheckedChange={(value) =>
                        setCapabilities((current) => ({
                          ...current,
                          [key]: value === true,
                        }))
                      }
                      disabled={mcpsBusy}
                      className="size-5"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(false)}
              disabled={mcpsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={mcpsBusy || !newName.trim() || !newEndpoint.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    await onAddMcpServer({
                      name: newName,
                      scope: createScope,
                      transportType,
                      endpoint: newEndpoint,
                      metadata: newMetadata,
                      capabilities,
                    });
                    setAddDialogOpen(false);
                    resetForm();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {mcpsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
