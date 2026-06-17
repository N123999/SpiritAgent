import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Sparkles } from "lucide-react";

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
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";
import type { CreateSkillRequest, DeleteSkillRequest, DesktopSkillListItem, DesktopSkillRootKind } from "@/types";

export function skillRootKindLabel(rootKind: DesktopSkillRootKind): string {
  if (rootKind === "user") {
    return i18n.t("settings.skillUserDir");
  }
  if (rootKind === "workspaceSpirit") {
    return i18n.t("settings.skillWorkspaceSpirit");
  }
  return i18n.t("settings.skillWorkspaceAgents");
}

function skillLocationLabel(item: DesktopSkillListItem): string {
  return skillRootKindLabel(item.rootKind);
}

const skillCreateRootOptions: Array<{
  kind: DesktopSkillRootKind;
  labelKey?: string;
  labelFallback: string;
  hintKey: string;
}> = [
  { kind: "user", labelKey: 'settings.skillUserDirShort', labelFallback: 'User', hintKey: 'settings.skillUserDirHint' },
  { kind: "workspaceSpirit", labelFallback: ".spirit", hintKey: 'settings.skillWorkspaceSpiritHint' },
  { kind: "workspaceAgents", labelFallback: ".agents", hintKey: 'settings.skillWorkspaceAgentsHint' },
];

export function SkillsSettingsPanel({
  snapshot,
  skillsBusy,
  apiReady,
  onCreateSkill,
  onDeleteSkill,
  onGenerateSkillNavigate,
}: Pick<
  SettingsViewProps,
  | "snapshot"
  | "skillsBusy"
  | "apiReady"
  | "onCreateSkill"
  | "onDeleteSkill"
  | "onGenerateSkillNavigate"
>) {
  const { t } = useTranslation();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteSkillRequest | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [createRootKind, setCreateRootKind] = useState<DesktopSkillRootKind>("user");

  const workspaceBindingDisabled = snapshot?.workspaceBinding === "none";
  const items = (snapshot?.skillsList ?? []).filter(
    (item) => !workspaceBindingDisabled || item.scope === "user",
  );
  const availableSkillCreateRootOptions = workspaceBindingDisabled
    ? skillCreateRootOptions.filter((option) => option.kind === "user")
    : skillCreateRootOptions;
  const localizedSkillCreateRootOptions = availableSkillCreateRootOptions.map((option) => ({
    ...option,
    label: option.labelKey ? t(option.labelKey) : option.labelFallback,
    hint: t(option.hintKey),
  }));

  const resetForm = () => {
    setNewName("");
    setNewContent("");
    setCreateRootKind("user");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Skills</h1>
          {workspaceBindingDisabled ? (
            <p className="text-xs text-muted-foreground">{t('app.noWorkspaceBindingHint')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onGenerateSkillNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!apiReady}
              title={t('settings.generateSkillTooltip')}
              onClick={() => onGenerateSkillNavigate()}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden />
              {t('settings.generateSkill')}
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
            disabled={skillsBusy}
          >
            {t('settings.newSkill')}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('settings.noSkillsFound')}</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <Badge variant="secondary" className="text-muted-foreground">
                    {skillLocationLabel(item)}
                  </Badge>
                  {!item.enabled ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {t('settings.skillDisabled')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{item.description}</p>
                <p className="truncate font-mono text-[0.65rem] text-muted-foreground/90" title={item.shortLabel}>
                  {item.shortLabel}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={skillsBusy}
                onClick={() => setDeleteTarget({ name: item.name, rootKind: item.rootKind })}
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
            <DialogTitle>{t('settings.deleteSkill')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteSkillConfirm', { name: deleteTarget?.name ?? '', location: deleteTarget ? skillRootKindLabel(deleteTarget.rootKind) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={skillsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={skillsBusy || !deleteTarget}
              onClick={() => {
                const target = deleteTarget;
                if (!target) {
                  return;
                }
                void (async () => {
                  try {
                    await onDeleteSkill(target);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {skillsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
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
            <DialogTitle>{t('settings.newSkill')}</DialogTitle>
            <DialogDescription>{t('settings.newSkillDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-2">
              <Label>{t('settings.saveLocation')}</Label>
              <div
                role="tablist"
                aria-label={t('settings.saveLocation')}
                className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
              >
                {localizedSkillCreateRootOptions.map((opt) => (
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
                    disabled={skillsBusy}
                    title={opt.hint}
                    onClick={() => setCreateRootKind(opt.kind)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {localizedSkillCreateRootOptions.find((o) => o.kind === createRootKind)?.hint}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-name">{t('settings.name')}</Label>
              <DesktopFormInput
                id="new-skill-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('settings.skillNamePlaceholder')}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-skill-content">{t('settings.content')}</Label>
              <DesktopFormTextarea
                id="new-skill-content"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('settings.skillContentPlaceholder')}
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
              disabled={skillsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                skillsBusy || !newName.trim() || !newContent.trim()
              }
              onClick={() => {
                void (async () => {
                  try {
                    const payload: CreateSkillRequest = {
                      name: newName,
                      rootKind: createRootKind,
                      description: newContent.trim(),
                    };
                    await onCreateSkill(payload);
                    setAddDialogOpen(false);
                    resetForm();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {skillsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
