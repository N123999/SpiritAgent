import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Sparkles } from "lucide-react";

import { skillRootKindLabel } from "@/components/settings/panels/skills-settings-panel";
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
import { DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import type { CreateRuleRequest, DesktopRuleListItem, DesktopSkillRootKind } from "@/types";

const ruleCreateRootOptions: Array<{
  kind: DesktopSkillRootKind;
  labelKey?: string;
  labelFallback: string;
  hintKey: string;
}> = [
  { kind: "user", labelKey: 'settings.skillUserDirShort', labelFallback: 'User', hintKey: 'settings.ruleUserDirHint' },
  { kind: "workspaceSpirit", labelFallback: ".spirit", hintKey: 'settings.ruleWorkspaceSpiritHint' },
  { kind: "workspaceAgents", labelFallback: "AGENTS.md", hintKey: 'settings.ruleWorkspaceAgentsHint' },
];

function ruleLocationLabel(item: DesktopRuleListItem): string {
  if (item.rootKind === "user") {
    return i18n.t('settings.skillUserDir');
  }
  if (item.rootKind === "workspaceSpirit") {
    return i18n.t('settings.skillWorkspaceSpirit');
  }
  if (item.rootKind === "workspaceAgents") {
    return i18n.t('settings.ruleWorkspaceAgentsHint');
  }
  return skillRootKindLabel(item.rootKind);
}

function ruleFileBaseName(shortLabel: string): string {
  const normalized = shortLabel.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function rulePreviewOneLine(excerpt: string): string {
  return excerpt.replace(/\s*\r?\n+\s*/g, " ").trim();
}

export function RulesSettingsPanel({
  snapshot,
  rulesBusy,
  apiReady,
  onCreateRule,
  onDeleteRule,
  onGenerateRuleNavigate,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "rulesBusy"
  | "apiReady"
  | "onCreateRule"
  | "onDeleteRule"
  | "onGenerateRuleNavigate"
>) {
  const { t } = useTranslation();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DesktopRuleListItem | null>(null);
  const [newDescription, setNewDescription] = useState("");
  const [createRootKind, setCreateRootKind] = useState<DesktopSkillRootKind>("user");

  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const items = (snapshot?.rulesList ?? [])
    .filter((item) => item.exists)
    .filter((item) => !workspaceBindingDisabled || item.scope === "user");
  const availableRuleCreateRootOptions = workspaceBindingDisabled
    ? ruleCreateRootOptions.filter((option) => option.kind === "user")
    : ruleCreateRootOptions;
  const localizedRuleCreateRootOptions = availableRuleCreateRootOptions.map((option) => ({
    ...option,
    label: option.labelKey ? t(option.labelKey) : option.labelFallback,
    hint: t(option.hintKey),
  }));

  const resetForm = () => {
    setNewDescription("");
    setCreateRootKind("user");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.rules')}</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t('app.noWorkspaceBindingHint')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateRuleNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title={t('settings.generateRuleTooltip')}
              onClick={() => onGenerateRuleNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {t('settings.generateRule')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => {
              resetForm();
              setAddDialogOpen(true);
            }}
            disabled={rulesBusy}
          >
            {t('settings.newRule')}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noRulesFound')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{ruleFileBaseName(item.shortLabel)}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {ruleLocationLabel(item)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t('settings.ruleDisabled')}
                    </Badge>
                  ) : null}
                </div>
                {item.previewExcerpt ? (
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={rulePreviewOneLine(item.previewExcerpt)}
                  >
                    {rulePreviewOneLine(item.previewExcerpt)}
                  </p>
                ) : null}
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground/90" title={item.shortLabel}>
                  {item.shortLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={rulesBusy}
                onClick={() => setDeleteTarget(item)}
              >
                {t('common.delete')}
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
            <DialogTitle>{t('settings.deleteRule')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteRuleConfirm', {
                name: deleteTarget ? ruleFileBaseName(deleteTarget.shortLabel) : '',
                location: deleteTarget ? ruleLocationLabel(deleteTarget) : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={rulesBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={rulesBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteRule({ id: target.id });
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {rulesBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
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
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.newRule')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t('settings.saveLocation')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.saveLocation')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedRuleCreateRootOptions.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    role="tab"
                    aria-selected={createRootKind === opt.kind}
                    className={cn(
                      "rounded-md px-2.5 text-xs font-medium transition-colors",
                      createRootKind === opt.kind
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    disabled={rulesBusy}
                    title={opt.hint}
                    onClick={() => setCreateRootKind(opt.kind)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedRuleCreateRootOptions.find((o) => o.kind === createRootKind)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-rule-content">{t('settings.content')}</Label>
              <DesktopFormTextarea
                id="new-rule-content"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('settings.ruleDescPlaceholder')}
                autoComplete="off"
                className="min-h-24 resize-y"
                required
              />
            </div>
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAddDialogOpen(false)}
              disabled={rulesBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={rulesBusy || !newDescription.trim()}
              onClick={() => {
                void (async () => {
                  try {
                    const payload: CreateRuleRequest = {
                      rootKind: createRootKind,
                      description: newDescription.trim(),
                    };
                    await onCreateRule(payload);
                    setAddDialogOpen(false);
                    resetForm();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {rulesBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
