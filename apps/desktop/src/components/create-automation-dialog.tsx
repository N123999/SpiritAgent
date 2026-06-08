import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import { AutomationScheduleMenu } from "@/components/automation-schedule-menu";
import { ModelPickerMenu } from "@/components/model-picker-menu";
import { WorkspaceSelectorMenu } from "@/components/workspace-selector-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ApprovalLevel,
  DesktopAutomationSchedule,
  DesktopCreateAutomationRequest,
  DesktopModelReasoningEffort,
  DesktopSnapshot,
} from "@/types";
import { cn } from "@/lib/utils";

type CreateAutomationDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: DesktopSnapshot | null;
  disabled?: boolean;
  onSubmit(request: DesktopCreateAutomationRequest): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
};

export function CreateAutomationDialog({
  open,
  onOpenChange,
  snapshot,
  disabled,
  onSubmit,
  onAddWorkspace,
}: CreateAutomationDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [schedule, setSchedule] = useState<DesktopAutomationSchedule>({ kind: "daily", hour: 20, minute: 0 });
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [modelName, setModelName] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<DesktopModelReasoningEffort | undefined>();
  const [approvalLevel, setApprovalLevel] = useState<ApprovalLevel>("default");

  useEffect(() => {
    if (!open || !snapshot) {
      return;
    }
    setTitle("");
    setOverview("");
    setSchedule({ kind: "daily", hour: 20, minute: 0 });
    setWorkspaceRoot(snapshot.workspaceRoot);
    setModelName(snapshot.config.activeModel);
    const activeModel = snapshot.config.models.find((model) => model.name === snapshot.config.activeModel);
    setReasoningEffort(activeModel?.reasoningEffort);
    setApprovalLevel(snapshot.conversation.approvalLevel);
  }, [open, snapshot]);

  const canSubmit =
    title.trim().length > 0
    && overview.trim().length > 0
    && workspaceRoot.trim().length > 0
    && modelName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,40rem)] max-w-2xl flex-col gap-0 p-0 sm:max-w-2xl" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("automations.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pt-6 pb-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("automations.dialogTitlePlaceholder")}
            disabled={disabled}
            className="w-full border-0 bg-transparent text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <textarea
            value={overview}
            onChange={(event) => setOverview(event.target.value)}
            placeholder={t("automations.dialogOverviewPlaceholder")}
            disabled={disabled}
            rows={8}
            className={cn(
              "min-h-[12rem] w-full resize-none border-0 bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70",
            )}
          />
        </div>
        <DialogFooter className="mx-0 mb-0 flex-col gap-3 border-t border-border/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <AutomationScheduleMenu
              schedule={schedule}
              disabled={disabled}
              onScheduleChange={setSchedule}
            />
            {snapshot ? (
              <>
                <WorkspaceSelectorMenu
                  currentWorkspaceRoot={workspaceRoot}
                  workspaceBinding="project"
                  availableWorkspaces={snapshot.availableWorkspaces}
                  disabled={disabled}
                  showNoWorkspaceOption={false}
                  onSelectWorkspace={setWorkspaceRoot}
                  onAddWorkspace={onAddWorkspace}
                />
                <ModelPickerMenu
                  models={snapshot.config.models}
                  catalogHints={snapshot.config.modelCatalogHints}
                  activeModelName={modelName}
                  activeReasoningEffort={reasoningEffort}
                  disabled={disabled}
                  onModelSelect={(name) => {
                    setModelName(name);
                    const profile = snapshot.config.models.find((model) => model.name === name);
                    setReasoningEffort(profile?.reasoningEffort);
                  }}
                  onModelReasoningEffortSelect={(name, effort) => {
                    setModelName(name);
                    setReasoningEffort(effort);
                  }}
                />
                <ApprovalLevelMenu
                  approvalLevel={approvalLevel}
                  disabled={disabled}
                  onApprovalLevelChange={setApprovalLevel}
                />
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={disabled}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={disabled || !canSubmit}
              onClick={() => {
                void onSubmit({
                  title: title.trim(),
                  overview: overview.trim(),
                  schedule,
                  workspaceRoot,
                  modelName,
                  ...(reasoningEffort ? { reasoningEffort } : {}),
                  approvalLevel,
                });
                onOpenChange(false);
              }}
            >
              {t("common.create")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
