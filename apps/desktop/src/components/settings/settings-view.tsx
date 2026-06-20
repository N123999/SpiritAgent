import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { isViteDev } from "@/lib/vite-dev";
import { AgentsSettingsPanel } from "@/components/settings/panels/agents-settings-panel";
import { GeneralSettingsPanel } from "@/components/settings/panels/general-settings-panel";
import { AppearanceSettingsPanel } from "@/components/settings/panels/appearance-settings-panel";
import { DeveloperSettingsPanel } from "@/components/settings/panels/developer-settings-panel";
import { DreamSettingsPanel } from "@/components/settings/panels/dream-settings-panel";
import { ExtensionConfigurationPanel } from "@/components/settings/panels/extension-configuration-panel";
import { ExtensionsSettingsPanel } from "@/components/settings/panels/extensions-settings-panel";
import { HooksSettingsPanel } from "@/components/settings/panels/hooks-settings-panel";
import { IntegrationsSettingsPanel } from "@/components/settings/panels/integrations-settings-panel";
import { McpsSettingsPanel } from "@/components/settings/panels/mcps-settings-panel";
import { NetworksSettingsPanel } from "@/components/settings/panels/networks-settings-panel";
import { RulesSettingsPanel } from "@/components/settings/panels/rules-settings-panel";
import { SkillsSettingsPanel } from "@/components/settings/panels/skills-settings-panel";
import { ModelsSettingsPanel } from "@/components/settings/models/models-settings-panel";
import { settingsPageTitleKey } from "@/components/settings/constants";
import type { SettingsViewProps } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { desktopMicaTintClass } from "@/lib/desktop-mica-surface";
import { cn } from "@/lib/utils";

export function SettingsView({
  tab,
  extensionSettingsId = null,
  theme,
  onThemeChange,
  font,
  onFontChange,
  clickablePointerCursor,
  onClickablePointerCursorChange,
  settings,
  snapshot,
  runtimeError,
  apiReady,
  modelsBusy,
  modelsPreviewBusy,
  mcpsBusy,
  hooksBusy,
  skillsBusy,
  rulesBusy,
  extensionsBusy,
  isElectronShell,
  onSavePatch,
  onResetWebHostPairing,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
  onAddMcpServer,
  onImportExtension,
  onDeleteExtension,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
  onDeleteMcpServer,
  onSaveHookEntry,
  onDeleteHookEntry,
  onInspectMcpServer,
  onCreateSkill,
  onDeleteSkill,
  onCreateRule,
  onDeleteRule,
  onListDreamsOverview,
  onInstallLspProvider,
  lspInstallBusy,
  onGenerateSkillNavigate,
  onGenerateRuleNavigate,
  onStartCompactionUiDemo,
  useMicaBackdrop = false,
  getGitHubAuthStatus,
  beginGitHubDeviceLogin,
  completeGitHubDeviceLogin,
  cancelGitHubDeviceLogin,
  disconnectGitHub,
}: SettingsViewProps) {
  const integrationsRuntime = useMemo(
    () => ({
      getGitHubAuthStatus,
      beginGitHubDeviceLogin,
      completeGitHubDeviceLogin,
      cancelGitHubDeviceLogin,
      disconnectGitHub,
    }),
    [
      getGitHubAuthStatus,
      beginGitHubDeviceLogin,
      completeGitHubDeviceLogin,
      cancelGitHubDeviceLogin,
      disconnectGitHub,
    ],
  );

  const { t } = useTranslation();
  const extensionSettingsItem = extensionSettingsId
    ? snapshot?.extensionsList.find((item) => item.id === extensionSettingsId)
    : undefined;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", desktopMicaTintClass(useMicaBackdrop))}>
      <ScrollArea className="min-h-0 flex-1" type="hover" scrollHideDelay={450}>
        <div className="flex min-h-full flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
            {!extensionSettingsItem && tab !== "models" && tab !== "skills" && tab !== "rules" && tab !== "mcps" && tab !== "hooks" && tab !== "extensions" && tab !== "agents" && tab !== "integrations" ? (
              <h1 className="mb-6 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
                {t(settingsPageTitleKey[tab])}
                {tab === "dreams" ? <Badge variant="outline">Beta</Badge> : null}
              </h1>
            ) : null}

            {runtimeError ? (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {runtimeError}
              </div>
            ) : null}

            {extensionSettingsItem ? (
              <ExtensionConfigurationPanel
                item={extensionSettingsItem}
                extensionsBusy={extensionsBusy}
                onUpdateExtensionSettings={onUpdateExtensionSettings}
                onUpdateExtensionSecret={onUpdateExtensionSecret}
              />
            ) : tab === "developer" && isViteDev ? (
              <DeveloperSettingsPanel onStartCompactionUiDemo={onStartCompactionUiDemo} />
            ) : tab === "dreams" ? (
              <DreamSettingsPanel
                theme={theme}
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onListDreamsOverview={onListDreamsOverview}
              />
            ) : tab === "agents" ? (
              <AgentsSettingsPanel
                settings={settings}
                snapshot={snapshot}
                lspInstallBusy={lspInstallBusy}
                onSavePatch={onSavePatch}
                onInstallLspProvider={onInstallLspProvider}
              />
            ) : tab === "models" ? (
              <ModelsSettingsPanel
                settings={settings}
                snapshot={snapshot}
                modelsBusy={modelsBusy}
                modelsPreviewBusy={modelsPreviewBusy}
                onSavePatch={onSavePatch}
                onAddModel={onAddModel}
                onAddProviderModels={onAddProviderModels}
                onPreviewModels={onPreviewModels}
                onRemoveModel={onRemoveModel}
                onRemoveProviderModels={onRemoveProviderModels}
              />
            ) : tab === "skills" ? (
              <SkillsSettingsPanel
                snapshot={snapshot}
                skillsBusy={skillsBusy}
                apiReady={apiReady}
                onCreateSkill={onCreateSkill}
                onDeleteSkill={onDeleteSkill}
                onGenerateSkillNavigate={onGenerateSkillNavigate}
              />
            ) : tab === "rules" ? (
              <RulesSettingsPanel
                snapshot={snapshot}
                rulesBusy={rulesBusy}
                apiReady={apiReady}
                onCreateRule={onCreateRule}
                onDeleteRule={onDeleteRule}
                onGenerateRuleNavigate={onGenerateRuleNavigate}
              />
            ) : tab === "extensions" ? (
              <ExtensionsSettingsPanel
                snapshot={snapshot}
                extensionsBusy={extensionsBusy}
                onImportExtension={onImportExtension}
                onDeleteExtension={onDeleteExtension}
              />
            ) : tab === "mcps" ? (
              <McpsSettingsPanel
                snapshot={snapshot}
                mcpsBusy={mcpsBusy}
                onAddMcpServer={onAddMcpServer}
                onDeleteMcpServer={onDeleteMcpServer}
                onInspectMcpServer={onInspectMcpServer}
              />
            ) : tab === "hooks" ? (
              <HooksSettingsPanel
                snapshot={snapshot}
                hooksBusy={hooksBusy}
                workspaceBinding={snapshot?.workspaceBinding ?? "none"}
                onSaveHookEntry={onSaveHookEntry}
                onDeleteHookEntry={onDeleteHookEntry}
              />
            ) : tab === "general" ? (
              <GeneralSettingsPanel settings={settings} onSavePatch={onSavePatch} />
            ) : tab === "appearance" ? (
              <AppearanceSettingsPanel
                theme={theme}
                onThemeChange={onThemeChange}
                font={font}
                onFontChange={onFontChange}
                clickablePointerCursor={clickablePointerCursor}
                onClickablePointerCursorChange={onClickablePointerCursorChange}
                settings={settings}
                onSavePatch={onSavePatch}
              />
            ) : tab === "networks" ? (
              <NetworksSettingsPanel
                settings={settings}
                snapshot={snapshot}
                onSavePatch={onSavePatch}
                onResetWebHostPairing={onResetWebHostPairing}
              />
            ) : tab === "integrations" ? (
              <IntegrationsSettingsPanel
                isElectronShell={isElectronShell}
                runtime={integrationsRuntime}
              />
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
