import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApprovalLevelMenu } from "@/components/approval-level-menu";
import {
  AutomationTriggerMenu,
  defaultDesktopTimeTrigger,
} from "@/components/automation-trigger-menu";
import { ModelPickerMenu } from "@/components/model-picker-menu";
import { WorkspaceSelectorMenu } from "@/components/workspace-selector-menu";
import { Button } from "@/components/ui/button";
import {
  isValidDesktopAutomationTrigger,
  type DesktopAutomationTrigger,
} from "@/lib/automation-trigger";
import { cn } from "@/lib/utils";
import type {
  ApprovalLevel,
  DesktopAutomationDefinition,
  DesktopModelReasoningEffort,
  DesktopSnapshot,
  DesktopUpdateAutomationRequest,
  GitHubAutomationRepositoriesSnapshot,
  SearchGitHubAutomationRepositoriesSnapshot,
} from "@/types";

type AutomationSettingsPanelProps = {
  automationId: string;
  definition: DesktopAutomationDefinition | undefined;
  snapshot: DesktopSnapshot | null;
  disabled?: boolean;
  githubConnected: boolean;
  onSave(patch: DesktopUpdateAutomationRequest): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
  listGitHubRepositories(page?: number): Promise<GitHubAutomationRepositoriesSnapshot>;
  searchGitHubRepositories(
    query: string,
    page?: number,
  ): Promise<SearchGitHubAutomationRepositoriesSnapshot>;
};

function triggersEqual(left: DesktopAutomationTrigger, right: DesktopAutomationTrigger): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const automationSettingsCardClassName = cn(
  "rounded-lg border border-border/40 bg-background/60 p-4",
);

export function AutomationSettingsPanel({
  automationId,
  definition,
  snapshot,
  disabled,
  githubConnected,
  onSave,
  onAddWorkspace,
  listGitHubRepositories,
  searchGitHubRepositories,
}: AutomationSettingsPanelProps) {
  const { t } = useTranslation();
  const initializedForAutomationIdRef = useRef<string | null>(null);
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [trigger, setTrigger] = useState<DesktopAutomationTrigger>(defaultDesktopTimeTrigger());
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [modelName, setModelName] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<DesktopModelReasoningEffort | undefined>();
  const [approvalLevel, setApprovalLevel] = useState<ApprovalLevel>("default");

  useEffect(() => {
    initializedForAutomationIdRef.current = null;
  }, [automationId]);

  useEffect(() => {
    if (!definition || initializedForAutomationIdRef.current === automationId) {
      return;
    }

    initializedForAutomationIdRef.current = automationId;
    setTitle(definition.title);
    setOverview(definition.overview);
    setTrigger(definition.trigger);
    setWorkspaceRoot(definition.workspaceRoot);
    setModelName(definition.modelName);
    setReasoningEffort(definition.reasoningEffort);
    setApprovalLevel(definition.approvalLevel);
  }, [automationId, definition]);

  const patch = useMemo((): DesktopUpdateAutomationRequest | null => {
    if (!definition) {
      return null;
    }

    const next: DesktopUpdateAutomationRequest = {};
    const trimmedTitle = title.trim();
    const trimmedOverview = overview.trim();

    if (trimmedTitle !== definition.title) {
      next.title = trimmedTitle;
    }
    if (trimmedOverview !== definition.overview) {
      next.overview = trimmedOverview;
    }
    if (!triggersEqual(trigger, definition.trigger)) {
      next.trigger = trigger;
    }
    if (workspaceRoot !== definition.workspaceRoot) {
      next.workspaceRoot = workspaceRoot;
    }
    if (modelName !== definition.modelName) {
      next.modelName = modelName;
    }
    if (reasoningEffort !== definition.reasoningEffort) {
      next.reasoningEffort = reasoningEffort;
    }
    if (approvalLevel !== definition.approvalLevel) {
      next.approvalLevel = approvalLevel;
    }

    return Object.keys(next).length > 0 ? next : null;
  }, [approvalLevel, definition, modelName, overview, reasoningEffort, trigger, title, workspaceRoot]);

  const canSave =
    title.trim().length > 0
    && overview.trim().length > 0
    && workspaceRoot.trim().length > 0
    && modelName.trim().length > 0
    && isValidDesktopAutomationTrigger(trigger)
    && (trigger.kind !== "github" || githubConnected)
    && patch !== null;

  if (!definition) {
    return (
      <div className={automationSettingsCardClassName}>
        <p className="py-8 text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className={automationSettingsCardClassName}>
      <div className="flex flex-col gap-4">
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <AutomationTriggerMenu
              trigger={trigger}
              disabled={disabled}
              githubConnected={githubConnected}
              onTriggerChange={setTrigger}
              listGitHubRepositories={listGitHubRepositories}
              searchGitHubRepositories={searchGitHubRepositories}
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
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={disabled || !canSave}
            onClick={() => {
              if (!patch) {
                return;
              }
              void Promise.resolve(onSave(patch)).then(() => {
                initializedForAutomationIdRef.current = null;
              });
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
