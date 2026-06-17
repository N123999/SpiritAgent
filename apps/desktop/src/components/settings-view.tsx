import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/lib/i18n";
import { isViteDev } from "@/lib/vite-dev";
import { ChevronsUpDown, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";

import { DreamGraphCard } from "@/components/dream-graph-card";
import { HooksSettingsPanel } from "@/components/settings/panels/hooks-settings-panel";
import { IntegrationsSettingsPanel } from "@/components/settings/panels/integrations-settings-panel";
import { FontSelect } from "@/components/font-select";
import type { SettingsSidebarTab } from "@/components/session-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopFormInput, DesktopFormTextarea } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { parseModelContextLength } from "@/lib/model-context-length";
import type { FontPreference } from "@/lib/font";
import { changeLanguage, VALID_LANGUAGES } from "@/lib/i18n";
import type { ThemePreference } from "@/lib/theme";
import { ModelCatalogDetailPanel } from "@/components/model-catalog-detail-panel";
import { ProviderIcon } from "@/components/provider-icon";
import {
  buildModelCatalogDetailMap,
  buildModelCatalogDisplayTitleMap,
  modelDisplayTitleFromMap,
  modelSettingsRowAriaLabel,
  providerSupportsModelCatalogDetail,
} from "@/lib/model-catalog-detail";
import { modelCapabilityLabel } from "@/lib/model-capability-label";
import {
  DESKTOP_FORM_FIELD_TRIGGER_INNER,
  DESKTOP_FORM_INPUT_SHELL,
} from "@/lib/desktop-chrome";
import { desktopMicaTintClass } from "@/lib/desktop-mica-surface";
import { isNativeBackdropBlurSupported } from "@/lib/desktop-shell";
import { runAfterRadixOverlayClose } from "@/lib/overlay-motion";
import { cn } from "@/lib/utils";
import {
  HoverDetailTooltip,
  useHoverDetailTooltipContext,
} from "@/components/ui/hover-detail-tooltip";
import type {
  AddModelRequest,
  AddMcpServerRequest,
  AddProviderModelsRequest,
  CreateRuleRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteHookEntryRequest,
  DeleteMcpServerRequest,
  DeleteRuleRequest,
  DeleteSkillRequest,
  DesktopDreamOverviewItem,
  DesktopExtensionListItem,
  DesktopMcpCapabilityToggles,
  DesktopMcpScope,
  DesktopMcpServerInspection,
  DesktopMcpServerListItem,
  DesktopMcpTransportType,
  ImportExtensionRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
  DesktopModelProvider,
  DesktopModelCapability,
  DesktopTransportKind,
  DesktopRuleListItem,
  DesktopSkillListItem,
  DesktopSkillRootKind,
  DesktopSnapshot,
  PreviewModelCatalogEntry,
  PreviewModelsRequest,
  PreviewModelsResponse,
  SaveHookEntryRequest,
  GitHubAuthStatus,
  GitHubDeviceAuthChallenge,
} from "@/types";
import {
  PROVIDER_PICKER_ROWS,
  defaultProviderConnectSite,
  listProviderConnectSiteOptions,
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
  resolveConnectApiBase,
  resolveProviderConnectApiBase,
} from "@/host/provider-presets";
import { bedrockApiBaseFromRegion } from "@spirit-agent/host-internal/bedrock-region";
import { azureApiBaseFromResourceName, isValidAzureResourceName } from "@spirit-agent/host-internal/azure-resource";
import { vertexApiBaseFromProjectAndLocation } from "@spirit-agent/host-internal/google-vertex-endpoints";
import {
  bedrockMantleApiBaseFromRegion,
  isBedrockMantleOpenAiModel,
} from "@spirit-agent/host-internal/bedrock-mantle";
import {
  hasBedrockIamCredentials,
  hasGoogleVertexServiceAccountCredentials,
} from "@/host/provider-api-key";
import { AgentsSettingsPanel } from "@/components/settings/panels/agents-settings-panel";
import { AppearanceSettingsPanel } from "@/components/settings/panels/appearance-settings-panel";
import { DeveloperSettingsPanel } from "@/components/settings/panels/developer-settings-panel";
import { DreamSettingsPanel } from "@/components/settings/panels/dream-settings-panel";
import { ExtensionConfigurationPanel } from "@/components/settings/panels/extension-configuration-panel";
import { ExtensionsSettingsPanel } from "@/components/settings/panels/extensions-settings-panel";
import { McpsSettingsPanel } from "@/components/settings/panels/mcps-settings-panel";
import { NetworksSettingsPanel } from "@/components/settings/panels/networks-settings-panel";
import { RulesSettingsPanel } from "@/components/settings/panels/rules-settings-panel";
import { SkillsSettingsPanel } from "@/components/settings/panels/skills-settings-panel";
import { settingsPageTitleKey } from "@/components/settings/constants";
import { formatExtensionInstalledAt, fileToBase64, formatSettingsTime } from "@/components/settings/formatters";
import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsFormState, SettingsViewProps } from "@/components/settings/types";
import { ScrollArea } from "@/components/ui/scroll-area";

export type { SettingsFormState } from "@/components/settings/types";

import {
  connectTransportOptionSummary,
  connectTransportOptionsForProvider,
  defaultConnectTransportKind,
  providerShowsConnectTransportPicker,
  resolveConnectTransportKindForProvider,
  resolveCustomConnectApiBase,
} from "@/components/settings/models/connect-transport";
import { ModelCapabilitiesCombobox } from "@/components/settings/models/model-capabilities-combobox";
import {
  type ModelDefaultAssignments,
  type ModelDefaultRole,
  type SettingsModelProfile,
  canAssignAsActiveModel,
  canAssignAsImageGenerationModel,
  canAssignAsLightweightChatModel,
  canAssignAsVideoGenerationModel,
  defaultCustomModelCapabilities,
  getSupportedModelDefaultRoles,
  modelDefaultActionLabel,
  normalizeModelCapabilitySelection,
} from "@/components/settings/models/model-defaults";
import { ModelSettingsRowButton, ModelSettingsRowWithHover } from "@/components/settings/models/model-settings-row";


function ModelsSettingsPanel({
  settings,
  snapshot,
  modelsBusy,
  modelsPreviewBusy,
  onSavePatch,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onRemoveModel,
  onRemoveProviderModels,
}: Pick<
  SettingsViewProps,
  | "settings"
  | "snapshot"
  | "modelsBusy"
  | "modelsPreviewBusy"
  | "onSavePatch"
  | "onAddModel"
  | "onAddProviderModels"
  | "onPreviewModels"
  | "onRemoveModel"
  | "onRemoveProviderModels"
>) {
  const { t } = useTranslation();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<DesktopModelProvider | null>(null);
  const [connectApiKey, setConnectApiKey] = useState("");
  const [connectAwsRegion, setConnectAwsRegion] = useState("");
  const [connectAzureResourceName, setConnectAzureResourceName] = useState("");
  const [connectAccessKeyId, setConnectAccessKeyId] = useState("");
  const [connectSecretAccessKey, setConnectSecretAccessKey] = useState("");
  const [connectVertexProject, setConnectVertexProject] = useState("");
  const [connectVertexLocation, setConnectVertexLocation] = useState("");
  const [connectVertexClientEmail, setConnectVertexClientEmail] = useState("");
  const [connectVertexPrivateKey, setConnectVertexPrivateKey] = useState("");
  const [connectName, setConnectName] = useState("");
  const [connectApiBase, setConnectApiBase] = useState("");
  const [connectCapabilities, setConnectCapabilities] = useState<DesktopModelCapability[]>(
    defaultCustomModelCapabilities,
  );
  const [connectContextLength, setConnectContextLength] = useState("");
  const [connectTransportKind, setConnectTransportKind] = useState<DesktopTransportKind>(
    "openai-compatible",
  );
  const [connectProviderSite, setConnectProviderSite] = useState("");
  const [connectAlibabaWorkspaceId, setConnectAlibabaWorkspaceId] = useState("");
  const [customConnectMode, setCustomConnectMode] = useState<"single" | "bulk">(
    "single",
  );
  const [bedrockConnectMode, setBedrockConnectMode] = useState<"bearer" | "iam">("bearer");
  const [vertexConnectMode, setVertexConnectMode] = useState<"adc" | "service-account" | "express">("adc");
  const [modelDefaultsDialogTarget, setModelDefaultsDialogTarget] = useState<string | null>(null);
  const [modelDefaultAssignments, setModelDefaultAssignments] = useState<ModelDefaultAssignments>({
    activeModel: false,
    imageGenerationModel: false,
    videoGenerationModel: false,
    lightweightChatModel: false,
  });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<DesktopModelProvider | null>(null);

  const models = snapshot?.config.models ?? [];
  const activeModel = settings.activeModel.trim() || (snapshot?.config.activeModel ?? "");
  const imageGenerationModel =
    settings.imageGenerationModel.trim() || (snapshot?.config.imageGenerationModel ?? "");
  const videoGenerationModel =
    settings.videoGenerationModel.trim() || (snapshot?.config.videoGenerationModel ?? "");
  const lightweightChatModel =
    settings.lightweightChatModel.trim() || (snapshot?.config.lightweightChatModel ?? "");
  const modelDefaultsDialogModel =
    modelDefaultsDialogTarget === null
      ? null
      : models.find((model) => model.name === modelDefaultsDialogTarget) ?? null;
  const canAssignActiveRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsActiveModel(modelDefaultsDialogModel, modelDefaultsDialogModel.name === activeModel);
  const canAssignImageGenerationRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsImageGenerationModel(
      modelDefaultsDialogModel,
      modelDefaultsDialogModel.name === imageGenerationModel,
    );
  const canAssignVideoGenerationRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsVideoGenerationModel(
      modelDefaultsDialogModel,
      modelDefaultsDialogModel.name === videoGenerationModel,
    );
  const canAssignLightweightChatRole =
    modelDefaultsDialogModel !== null &&
    canAssignAsLightweightChatModel(
      modelDefaultsDialogModel,
      modelDefaultsDialogModel.name === lightweightChatModel,
    );
  const isModelDefaultsDialogModelActive = modelDefaultsDialogModel?.name === activeModel;
  const isModelDefaultsDialogModelLightweight =
    modelDefaultsDialogModel?.name === lightweightChatModel;
  const hasModelDefaultAssignmentChanges =
    modelDefaultsDialogModel !== null &&
    (modelDefaultAssignments.activeModel !== isModelDefaultsDialogModelActive ||
      modelDefaultAssignments.imageGenerationModel !==
        (modelDefaultsDialogModel.name === imageGenerationModel) ||
      modelDefaultAssignments.videoGenerationModel !==
        (modelDefaultsDialogModel.name === videoGenerationModel) ||
      modelDefaultAssignments.lightweightChatModel !== isModelDefaultsDialogModelLightweight);

  const catalogDetailByModelName = useMemo(
    () => buildModelCatalogDetailMap(models, snapshot?.config.modelCatalogHints),
    [models, snapshot?.config.modelCatalogHints],
  );
  const displayTitleByModelName = useMemo(
    () => buildModelCatalogDisplayTitleMap(models, snapshot?.config.modelCatalogHints),
    [models, snapshot?.config.modelCatalogHints],
  );

  const providerGroups = new Map<DesktopModelProvider, typeof models>();
  const standaloneModels: typeof models = [];
  for (const model of models) {
    if (model.provider && model.provider !== "custom") {
      const group = providerGroups.get(model.provider) ?? [];
      group.push(model);
      providerGroups.set(model.provider, group);
    } else {
      standaloneModels.push(model);
    }
  }

  function providerLabel(provider: DesktopModelProvider): string {
    const row = PROVIDER_PICKER_ROWS.find((item) => item.id === provider);
    return row ? String(t(row.labelKey, { defaultValue: row.fallbackLabel })) : provider;
  }

  const resetConnectWizard = () => {
    setConnectApiKey("");
    setConnectAwsRegion("");
    setConnectAzureResourceName("");
    setConnectAccessKeyId("");
    setConnectSecretAccessKey("");
    setConnectVertexProject("");
    setConnectVertexLocation("");
    setConnectVertexClientEmail("");
    setConnectVertexPrivateKey("");
    setConnectName("");
    setConnectApiBase("");
    setConnectCapabilities(defaultCustomModelCapabilities);
    setConnectContextLength("");
    setConnectTransportKind("openai-compatible");
    setConnectProviderSite("");
    setConnectAlibabaWorkspaceId("");
    setCustomConnectMode("single");
    setBedrockConnectMode("bearer");
    setVertexConnectMode("adc");
    setSelectedProvider(null);
  };

  const resetConnectTransportKindForProvider = (provider: DesktopModelProvider) => {
    setConnectTransportKind(defaultConnectTransportKind(provider));
    setConnectProviderSite(defaultProviderConnectSite(provider) ?? "");
  };

  const openProviderPicker = () => {
    resetConnectWizard();
    setProviderQuery("");
    setProviderDialogOpen(true);
  };

  const startConnect = (id: DesktopModelProvider) => {
    setProviderDialogOpen(false);
    setSelectedProvider(id);
    setConnectApiKey("");
    setConnectAwsRegion("");
    setConnectAzureResourceName("");
    setConnectAccessKeyId("");
    setConnectSecretAccessKey("");
    setConnectVertexProject("");
    setConnectVertexLocation("");
    setConnectVertexClientEmail("");
    setConnectVertexPrivateKey("");
    setConnectName("");
    setConnectApiBase("");
    setConnectCapabilities(defaultCustomModelCapabilities);
    resetConnectTransportKindForProvider(id);
    setCustomConnectMode("single");
    setBedrockConnectMode("bearer");
    setVertexConnectMode("adc");
    setConnectDialogOpen(true);
  };

  const localizedProviderRows = PROVIDER_PICKER_ROWS.map((row) => ({
    ...row,
    label: providerLabel(row.id),
  }));
  const filteredProviders = localizedProviderRows.filter((row) =>
    row.label.toLowerCase().includes(providerQuery.trim().toLowerCase()),
  );
  const selectedProviderLabel =
    selectedProvider === null
      ? t('settings.connectProvider')
      : providerLabel(selectedProvider);

  const openModelDefaultsDialog = (model: SettingsModelProfile) => {
    setModelDefaultsDialogTarget(model.name);
    setModelDefaultAssignments({
      activeModel: model.name === activeModel,
      imageGenerationModel: model.name === imageGenerationModel,
      videoGenerationModel: model.name === videoGenerationModel,
      lightweightChatModel: model.name === lightweightChatModel,
    });
  };

  const closeModelDefaultsDialog = () => {
    setModelDefaultsDialogTarget(null);
    setModelDefaultAssignments({
      activeModel: false,
      imageGenerationModel: false,
      videoGenerationModel: false,
      lightweightChatModel: false,
    });
  };

  const saveModelDefaultAssignments = async () => {
    if (!modelDefaultsDialogModel) {
      return;
    }

    const patch: Partial<SettingsFormState> = {};

    if (modelDefaultAssignments.activeModel && modelDefaultsDialogModel.name !== activeModel) {
      patch.activeModel = modelDefaultsDialogModel.name;
    }

    if (canAssignImageGenerationRole) {
      if (
        modelDefaultAssignments.imageGenerationModel &&
        modelDefaultsDialogModel.name !== imageGenerationModel
      ) {
        patch.imageGenerationModel = modelDefaultsDialogModel.name;
      } else if (
        !modelDefaultAssignments.imageGenerationModel &&
        modelDefaultsDialogModel.name === imageGenerationModel
      ) {
        patch.imageGenerationModel = "";
      }
    }

    if (canAssignVideoGenerationRole) {
      if (
        modelDefaultAssignments.videoGenerationModel &&
        modelDefaultsDialogModel.name !== videoGenerationModel
      ) {
        patch.videoGenerationModel = modelDefaultsDialogModel.name;
      } else if (
        !modelDefaultAssignments.videoGenerationModel &&
        modelDefaultsDialogModel.name === videoGenerationModel
      ) {
        patch.videoGenerationModel = "";
      }
    }

    if (canAssignLightweightChatRole) {
      if (
        modelDefaultAssignments.lightweightChatModel &&
        modelDefaultsDialogModel.name !== lightweightChatModel
      ) {
        patch.lightweightChatModel = modelDefaultsDialogModel.name;
      } else if (
        !modelDefaultAssignments.lightweightChatModel &&
        modelDefaultsDialogModel.name === lightweightChatModel
      ) {
        patch.lightweightChatModel = "";
      }
    }

    if (Object.keys(patch).length === 0) {
      closeModelDefaultsDialog();
      return;
    }

    await onSavePatch(patch);
    closeModelDefaultsDialog();
  };

  const saveSingleModelDefaultRole = async (
    model: SettingsModelProfile,
    role: ModelDefaultRole,
  ) => {
    const patch: Partial<SettingsFormState> = {};

    if (role === "activeModel") {
      if (model.name !== activeModel) {
        patch.activeModel = model.name;
      }
    } else if (role === "imageGenerationModel") {
      if (model.name !== imageGenerationModel) {
        patch.imageGenerationModel = model.name;
      }
    } else if (role === "videoGenerationModel") {
      if (model.name !== videoGenerationModel) {
        patch.videoGenerationModel = model.name;
      }
    } else if (model.name !== lightweightChatModel) {
      patch.lightweightChatModel = model.name;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    await onSavePatch(patch);
  };

  const handleModelDefaultAction = (model: SettingsModelProfile) => {
    const supportedRoles = getSupportedModelDefaultRoles(
      model,
      activeModel,
      imageGenerationModel,
      videoGenerationModel,
      lightweightChatModel,
    );

    if (supportedRoles.length === 0) {
      openModelDefaultsDialog(model);
      return;
    }

    if (supportedRoles.length === 1) {
      void (async () => {
        try {
          await saveSingleModelDefaultRole(model, supportedRoles[0]);
        } catch {
          /* runtimeError */
        }
      })();
      return;
    }

    openModelDefaultsDialog(model);
  };

  const connectTransportKindForRequest = resolveConnectTransportKindForProvider(
    selectedProvider,
    connectTransportKind,
  );

  const connectProviderSiteForRequest = connectProviderSite.trim() || undefined;
  const connectAlibabaWorkspaceIdForRequest = connectAlibabaWorkspaceId.trim() || undefined;
  const connectAlibabaWorkspaceRequired =
    selectedProvider === "alibaba"
    && connectProviderSiteForRequest !== undefined
    && providerConnectSiteRequiresWorkspaceId("alibaba", connectProviderSiteForRequest);
  const connectProviderSiteForApiBase =
    connectProviderSiteForRequest
    && selectedProvider !== null
    && providerConnectSiteRequiresWorkspaceId(selectedProvider, connectProviderSiteForRequest)
    && !connectAlibabaWorkspaceIdForRequest
      ? undefined
      : connectProviderSiteForRequest;

  const effectiveApiBase =
    selectedProvider === null
      ? ""
      : selectedProvider === "amazon-bedrock"
        ? bedrockApiBaseFromRegion(connectAwsRegion)
        : selectedProvider === "azure"
          ? azureApiBaseFromResourceName(connectAzureResourceName)
        : selectedProvider === "google-vertex-ai" && vertexConnectMode !== "express"
          ? vertexApiBaseFromProjectAndLocation(connectVertexProject, connectVertexLocation)
        : selectedProvider === "custom"
        ? resolveCustomConnectApiBase(connectApiBase)
        : connectTransportKindForRequest !== undefined
          ? resolveProviderConnectApiBase(
              selectedProvider,
              connectTransportKindForRequest,
              {
                ...(connectProviderSiteForApiBase ? { site: connectProviderSiteForApiBase } : {}),
                ...(connectAlibabaWorkspaceIdForRequest
                  ? { workspaceId: connectAlibabaWorkspaceIdForRequest }
                  : {}),
              },
            )
          : resolveConnectApiBase(selectedProvider, "");

  const hasBedrockCatalogCredentials = hasBedrockIamCredentials({
    accessKeyId: connectAccessKeyId,
    secretAccessKey: connectSecretAccessKey,
  });
  const hasVertexCatalogCredentials = hasGoogleVertexServiceAccountCredentials({
    clientEmail: connectVertexClientEmail,
    privateKey: connectVertexPrivateKey,
  });
  const vertexConnectFields = {
    ...(connectVertexProject.trim() ? { vertexProject: connectVertexProject.trim() } : {}),
    ...(connectVertexLocation.trim() ? { vertexLocation: connectVertexLocation.trim() } : {}),
    ...(connectVertexClientEmail.trim() ? { vertexClientEmail: connectVertexClientEmail.trim() } : {}),
    ...(connectVertexPrivateKey.trim() ? { vertexPrivateKey: connectVertexPrivateKey.trim() } : {}),
  };

  const syncCatalogFromUpstream = async (forceRefresh: boolean) => {
    if (selectedProvider === null) {
      return;
    }
    if (selectedProvider === "amazon-bedrock") {
      if (!connectAwsRegion.trim()) {
        throw new Error(t('settings.bedrockRegionRequired'));
      }
      if (!hasBedrockCatalogCredentials) {
        throw new Error(t('settings.bedrockCatalogIamRequired'));
      }
    } else if (selectedProvider === "google-vertex-ai") {
      if (!connectVertexProject.trim() || !connectVertexLocation.trim()) {
        throw new Error(t('settings.vertexProjectLocationRequired'));
      }
      if (vertexConnectMode === "service-account" && !hasVertexCatalogCredentials) {
        throw new Error(t('settings.vertexCatalogServiceAccountRequired'));
      }
      if (vertexConnectMode === "express") {
        throw new Error(t('settings.vertexExpressCatalogUnsupported'));
      }
    } else if (selectedProvider === "custom") {
      if (!connectApiBase.trim()) {
        throw new Error(t('settings.endpointRequired'));
      }
    } else if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    if (connectAlibabaWorkspaceRequired && !connectAlibabaWorkspaceIdForRequest) {
      throw new Error(t('settings.alibabaWorkspaceIdRequired'));
    }
    const res = await onPreviewModels({
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      provider: selectedProvider,
      ...(selectedProvider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(selectedProvider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { providerSite: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { alibabaWorkspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
      forceRefresh,
    });
    if (res.modelIds.length === 0) {
      throw new Error(t('settings.noModelsReturned'));
    }
    const bulk: AddProviderModelsRequest = {
      apiBase: effectiveApiBase,
      apiKey: connectApiKey,
      modelIds: res.modelIds,
      ...(res.models ? { modelCatalog: res.models } : {}),
      provider: selectedProvider,
      ...(selectedProvider === "amazon-bedrock"
        ? {
            awsRegion: connectAwsRegion.trim(),
            accessKeyId: connectAccessKeyId.trim(),
            secretAccessKey: connectSecretAccessKey.trim(),
          }
        : {}),
      ...(selectedProvider === "google-vertex-ai" ? vertexConnectFields : {}),
      ...(connectTransportKindForRequest !== undefined
        ? { transportKind: connectTransportKindForRequest }
        : {}),
      ...(connectProviderSiteForRequest ? { providerSite: connectProviderSiteForRequest } : {}),
      ...(connectAlibabaWorkspaceIdForRequest
        ? { alibabaWorkspaceId: connectAlibabaWorkspaceIdForRequest }
        : {}),
    };
    await onAddProviderModels(bulk);
    setConnectDialogOpen(false);
    runAfterRadixOverlayClose(resetConnectWizard);
  };

  const saveCustomSingle = async () => {
    if (selectedProvider === null || selectedProvider !== "custom") {
      return;
    }
    const name = connectName.trim();
    const apiBase = effectiveApiBase;
    if (!name) {
      throw new Error(t('settings.modelNameRequired'));
    }
    if (!connectApiBase.trim()) {
      throw new Error(t('settings.endpointRequired'));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t('settings.contextLengthInvalid'));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase,
      apiKey: connectApiKey,
      provider: "custom",
      transportKind: connectTransportKind,
      capabilities: normalizeModelCapabilitySelection(connectCapabilities),
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    setConnectDialogOpen(false);
    runAfterRadixOverlayClose(resetConnectWizard);
  };

  const saveBedrockBearerSingle = async () => {
    if (selectedProvider !== "amazon-bedrock") {
      return;
    }
    const awsRegion = connectAwsRegion.trim();
    const name = connectName.trim();
    if (!awsRegion) {
      throw new Error(t('settings.bedrockRegionRequired'));
    }
    if (!name) {
      throw new Error(t('settings.modelNameRequired'));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t('settings.contextLengthInvalid'));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: isBedrockMantleOpenAiModel(name)
        ? bedrockMantleApiBaseFromRegion(awsRegion)
        : bedrockApiBaseFromRegion(awsRegion),
      apiKey: connectApiKey,
      provider: "amazon-bedrock",
      transportKind: "bedrock",
      awsRegion,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    setConnectDialogOpen(false);
    runAfterRadixOverlayClose(resetConnectWizard);
  };

  const saveAzureSingle = async () => {
    if (selectedProvider !== "azure") {
      return;
    }
    const azureResourceName = connectAzureResourceName.trim();
    const name = connectName.trim();
    if (!azureResourceName) {
      throw new Error(t('settings.azureResourceNameRequired'));
    }
    if (!isValidAzureResourceName(azureResourceName)) {
      throw new Error(t('settings.azureResourceNameInvalid'));
    }
    if (!name) {
      throw new Error(t('settings.azureDeploymentNameRequired'));
    }
    if (/\s/u.test(name)) {
      throw new Error(t('settings.azureDeploymentNameWhitespace'));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t('settings.contextLengthInvalid'));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: azureApiBaseFromResourceName(azureResourceName),
      apiKey: connectApiKey,
      provider: "azure",
      transportKind: "open-responses",
      azureResourceName,
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    setConnectDialogOpen(false);
    runAfterRadixOverlayClose(resetConnectWizard);
  };

  const saveVertexExpressSingle = async () => {
    if (selectedProvider !== "google-vertex-ai" || vertexConnectMode !== "express") {
      return;
    }
    const name = connectName.trim();
    if (!name) {
      throw new Error(t('settings.modelNameRequired'));
    }
    if (!connectApiKey.trim()) {
      throw new Error(t('settings.apiKeyRequired'));
    }
    const contextLengthRaw = connectContextLength.trim();
    let contextLength: number | undefined;
    if (contextLengthRaw) {
      const parsed = parseModelContextLength(Number(contextLengthRaw));
      if (parsed === undefined) {
        throw new Error(t('settings.contextLengthInvalid'));
      }
      contextLength = parsed;
    }
    await onAddModel({
      name,
      apiBase: "",
      apiKey: connectApiKey,
      provider: "google-vertex-ai",
      transportKind: "openai-compatible",
      ...(contextLength !== undefined ? { contextLength } : {}),
    });
    setConnectDialogOpen(false);
    runAfterRadixOverlayClose(resetConnectWizard);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('settings.modelsTitle')}</h1>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            openProviderPicker();
          }}
          disabled={modelsBusy || modelsPreviewBusy}
        >
          {t('settings.connectProvider')}
        </Button>
      </div>

      <div className="space-y-3">
        {models.length === 0 ? (
          <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t('settings.noSavedModels')}</p>
          </div>
        ) : (
          <>
            {Array.from(providerGroups.entries()).map(([provider, groupModels]) => {
              const groupHasKey = groupModels.some((m) => m.keyConfigured);
              return (
                <div
                  key={provider}
                  className="rounded-lg border border-border/40 bg-background/80"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border/35 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {providerLabel(provider)}
                      </span>
                      <Badge variant="secondary" className="text-muted-foreground shrink-0">
                        {groupModels.length} {t('settings.modelsCount')}
                      </Badge>
                      {groupHasKey ? (
                        <Badge variant="secondary" className="text-muted-foreground shrink-0">
                          {t('settings.keySaved')}
                        </Badge>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setDeleteGroupTarget(provider)}
                    >
                      {t('settings.deleteGroup')}
                    </Button>
                  </div>
                  {providerSupportsModelCatalogDetail(provider)
                  && groupModels.some((model) => catalogDetailByModelName.has(model.name)) ? (
                    <HoverDetailTooltip<SettingsModelProfile>
                      getItemId={(model) => model.name}
                      openDelayMs={300}
                    >
                      <HoverDetailTooltip.TriggerZone className="divide-y divide-border/35">
                        {groupModels.map((model) => {
                          const isActive = model.name === activeModel;
                          const isImageDefault = model.name === imageGenerationModel;
                          const isLightweightDefault = model.name === lightweightChatModel;
                          const supportedDefaultRoles = getSupportedModelDefaultRoles(
                            model,
                            activeModel,
                            imageGenerationModel,
                            videoGenerationModel,
                            lightweightChatModel,
                          );
                          const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                          const rowDisabled = modelsBusy || modelsPreviewBusy;
                          const hasDetail = catalogDetailByModelName.has(model.name);
                          const displayTitle = modelDisplayTitleFromMap(
                            model.name,
                            displayTitleByModelName,
                          );

                          if (!hasDetail) {
                            return (
                              <ModelSettingsRowButton
                                key={model.name}
                                model={model}
                                displayTitle={displayTitle}
                                isActive={isActive}
                                isImageDefault={isImageDefault}
                                isLightweightDefault={isLightweightDefault}
                                defaultActionLabel={defaultActionLabel}
                                disabled={rowDisabled}
                                onDefaultAction={() => handleModelDefaultAction(model)}
                              />
                            );
                          }

                          return (
                            <ModelSettingsRowWithHover
                              key={model.name}
                              model={model}
                              displayTitle={displayTitle}
                              isActive={isActive}
                              isImageDefault={isImageDefault}
                              isLightweightDefault={isLightweightDefault}
                              defaultActionLabel={defaultActionLabel}
                              disabled={rowDisabled}
                              onDefaultAction={() => handleModelDefaultAction(model)}
                            />
                          );
                        })}
                      </HoverDetailTooltip.TriggerZone>
                      <HoverDetailTooltip.Content
                        side="right"
                        align="start"
                        sideOffset={8}
                        collisionPadding={16}
                        className="z-[100] w-80 max-w-[min(20rem,calc(100vw-2rem))] p-3"
                      >
                        {(activeRow) => {
                          const row = activeRow as SettingsModelProfile | null;
                          if (!row) {
                            return null;
                          }
                          const catalogEntry = catalogDetailByModelName.get(row.name);
                          if (!catalogEntry) {
                            return null;
                          }
                          return (
                            <ModelCatalogDetailPanel
                              model={row}
                              catalogEntry={catalogEntry}
                              providerLabel={providerLabel(provider)}
                            />
                          );
                        }}
                      </HoverDetailTooltip.Content>
                    </HoverDetailTooltip>
                  ) : (
                    <div className="divide-y divide-border/35">
                      {groupModels.map((model) => {
                        const isActive = model.name === activeModel;
                        const isImageDefault = model.name === imageGenerationModel;
                        const isLightweightDefault = model.name === lightweightChatModel;
                        const supportedDefaultRoles = getSupportedModelDefaultRoles(
                          model,
                          activeModel,
                          imageGenerationModel,
                          videoGenerationModel,
                          lightweightChatModel,
                        );
                        const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                        const displayTitle = modelDisplayTitleFromMap(
                          model.name,
                          displayTitleByModelName,
                        );
                        return (
                          <ModelSettingsRowButton
                            key={model.name}
                            model={model}
                            displayTitle={displayTitle}
                            isActive={isActive}
                            isImageDefault={isImageDefault}
                            isLightweightDefault={isLightweightDefault}
                            defaultActionLabel={defaultActionLabel}
                            disabled={modelsBusy || modelsPreviewBusy}
                            onDefaultAction={() => handleModelDefaultAction(model)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {standaloneModels.length > 0 && (
              <div className="overflow-hidden divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80">
                {standaloneModels.map((model) => {
                  const isActive = model.name === activeModel;
                  const isImageDefault = model.name === imageGenerationModel;
                  const isLightweightDefault = model.name === lightweightChatModel;
                  const supportedDefaultRoles = getSupportedModelDefaultRoles(
                    model,
                    activeModel,
                    imageGenerationModel,
                    videoGenerationModel,
                    lightweightChatModel,
                  );
                  const defaultActionLabel = modelDefaultActionLabel(supportedDefaultRoles);
                  const isStandaloneModelDisabled = modelsBusy || modelsPreviewBusy;
                  const displayTitle = modelDisplayTitleFromMap(
                    model.name,
                    displayTitleByModelName,
                  );
                  const rowAriaLabel = modelSettingsRowAriaLabel(
                    defaultActionLabel,
                    model.name,
                    displayTitle,
                  );
                  return (
                    <div
                      key={model.name}
                      role="button"
                      tabIndex={isStandaloneModelDisabled ? -1 : 0}
                      aria-disabled={isStandaloneModelDisabled}
                      title={rowAriaLabel}
                      aria-label={rowAriaLabel}
                      className={cn(
                        "flex flex-col gap-3 px-4 py-4 outline-none sm:flex-row sm:items-center sm:justify-between sm:gap-4",
                        !isStandaloneModelDisabled &&
                          "cursor-pointer hover:bg-foreground/[0.06] dark:hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring/50",
                      )}
                      onClick={() => {
                        if (isStandaloneModelDisabled) {
                          return;
                        }
                        handleModelDefaultAction(model);
                      }}
                      onKeyDown={(event) => {
                        if (
                          isStandaloneModelDisabled ||
                          event.target !== event.currentTarget ||
                          (event.key !== "Enter" && event.key !== " ")
                        ) {
                          return;
                        }
                        event.preventDefault();
                        handleModelDefaultAction(model);
                      }}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {displayTitle}
                          </span>
                          {isActive ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.currentInference')}
                            </Badge>
                          ) : null}
                          {isImageDefault ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.currentImageGen')}
                            </Badge>
                          ) : null}
                          {isLightweightDefault ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.currentLightweightChat')}
                            </Badge>
                          ) : null}
                          {model.keyConfigured ? (
                            <Badge variant="secondary" className="text-muted-foreground">
                              {t('settings.keySaved')}
                            </Badge>
                          ) : null}
                          {model.capabilities?.map((capability) => (
                            <Badge key={capability} variant="outline" className="text-muted-foreground">
                              {modelCapabilityLabel(capability)}
                            </Badge>
                          ))}
                        </div>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={model.apiBase}
                        >
                          {model.apiBase}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          className="shrink-0"
                          disabled={modelsBusy || modelsPreviewBusy}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteTarget(model.name);
                          }}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={modelDefaultsDialogTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeModelDefaultsDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.setAsDefault')}</DialogTitle>
            <DialogDescription>
              {t('settings.setAsDefaultDescription', { name: modelDefaultsDialogModel?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {canAssignActiveRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive || undefined}
              >
                <Checkbox
                  id="model-default-active"
                  checked={modelDefaultAssignments.activeModel}
                  disabled={modelsBusy || modelsPreviewBusy || isModelDefaultsDialogModelActive}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      activeModel: checked === true || isModelDefaultsDialogModelActive,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="model-default-active" className="text-sm font-medium text-foreground">
                    {t('settings.activeModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {isModelDefaultsDialogModelActive
                      ? t('settings.activeModelKeepHint')
                      : t('settings.activeModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignImageGenerationRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-image-generation"
                  checked={modelDefaultAssignments.imageGenerationModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      imageGenerationModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-image-generation"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('settings.imageGenModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t('settings.imageGenModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignVideoGenerationRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-video-generation"
                  checked={modelDefaultAssignments.videoGenerationModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      videoGenerationModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-video-generation"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('settings.videoGenModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t('settings.videoGenModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {canAssignLightweightChatRole ? (
              <div
                className="group/field flex items-start gap-3 rounded-lg border border-dialog-panel-border px-3 py-3 transition-colors data-[disabled=true]:opacity-70"
                data-disabled={modelsBusy || modelsPreviewBusy || undefined}
              >
                <Checkbox
                  id="model-default-lightweight-chat"
                  checked={modelDefaultAssignments.lightweightChatModel}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onCheckedChange={(checked) =>
                    setModelDefaultAssignments((current) => ({
                      ...current,
                      lightweightChatModel: checked === true,
                    }))
                  }
                />
                <div className="grid gap-1.5">
                  <Label
                    htmlFor="model-default-lightweight-chat"
                    className="text-sm font-medium text-foreground"
                  >
                    {t('settings.lightweightChatModelLabel')}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {t('settings.lightweightChatModelUsage')}
                  </p>
                </div>
              </div>
            ) : null}
            {!canAssignActiveRole
            && !canAssignImageGenerationRole
            && !canAssignVideoGenerationRole
            && !canAssignLightweightChatRole ? (
              <div className="rounded-lg border border-dashed border-dialog-panel-border px-3 py-4 text-sm text-muted-foreground">
                {t('settings.noDefaultRolesForModel')}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeModelDefaultsDialog}
              disabled={modelsBusy || modelsPreviewBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={modelsBusy || modelsPreviewBusy || !hasModelDefaultAssignmentChanges}
              onClick={() => {
                void (async () => {
                  try {
                    await saveModelDefaultAssignments();
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>{t('settings.deleteModel')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteModelConfirm', { name: deleteTarget ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={modelsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={modelsBusy || !deleteTarget}
              onClick={() => {
                const name = deleteTarget;
                if (!name) {
                  return;
                }
                void (async () => {
                  try {
                    await onRemoveModel(name);
                    setDeleteTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteGroupTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.deleteProviderGroup')}</DialogTitle>
            <DialogDescription>
              {t('settings.deleteProviderGroupConfirm', { provider: deleteGroupTarget ? providerLabel(deleteGroupTarget) : '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteGroupTarget(null)}
              disabled={modelsBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={modelsBusy || !deleteGroupTarget}
              onClick={() => {
                const provider = deleteGroupTarget;
                if (!provider) {
                  return;
                }
                void (async () => {
                  try {
                    await onRemoveProviderModels(provider);
                    setDeleteGroupTarget(null);
                  } catch {
                    /* runtimeError */
                  }
                })();
              }}
            >
              {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t('settings.deleteGroup')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={providerDialogOpen}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) {
            setProviderQuery("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>{t('settings.selectProvider')}</DialogTitle>
            <DialogDescription>{t('settings.selectProviderDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <DesktopFormInput
              value={providerQuery}
              onChange={(e) => setProviderQuery(e.target.value)}
              placeholder={t('common.search')}
              autoComplete="off"
            />
            <ScrollArea className="h-56 rounded-md border border-dialog-panel-border">
              <div className="p-1">
                {filteredProviders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('app.noMatches')}</p>
                ) : (
                  filteredProviders.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                      onClick={() => startConnect(row.id)}
                    >
                      <ProviderIcon providerId={row.id} />
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={connectDialogOpen}
        // 不在 onOpenChange(false) 立刻 resetConnectWizard：Dialog exit 动画未结束时 Content 仍挂载，
        // selectedProvider 被清 null 会导致标题回退「连接提供商」、条件 Select 消失。见 runAfterRadixOverlayClose / openProviderPicker。
        onOpenChange={setConnectDialogOpen}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>
              {selectedProvider === "custom" ? t('settings.customConnection') : selectedProviderLabel}
            </DialogTitle>
            <DialogDescription>
              {selectedProvider === "custom"
                ? t('settings.customConnectionDescription')
                : selectedProvider === "volcengine"
                  ? t('settings.volcengineConnectionDescription')
                  : selectedProvider === "siliconflow"
                    ? t('settings.siliconflowConnectionDescription')
                    : selectedProvider === "moonshot-ai"
                      ? t('settings.moonshotConnectionDescription')
                      : selectedProvider === "minimax"
                        ? t('settings.minimaxConnectionDescription')
                        : selectedProvider === "alibaba"
                          ? t('settings.alibabaConnectionDescription')
                  : providerShowsConnectTransportPicker(selectedProvider)
                      ? t('settings.providerConnectionDescription')
                      : t('settings.providerSimpleDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-1">
            {selectedProvider && providerSupportsSiteSelection(selectedProvider) ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-provider-site">{t('settings.site')}</Label>
                <div className={DESKTOP_FORM_INPUT_SHELL}>
                  <Select
                    value={connectProviderSite}
                    onValueChange={setConnectProviderSite}
                  >
                    <SelectTrigger
                      id="connect-provider-site"
                      className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {listProviderConnectSiteOptions(selectedProvider).map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {t(option.labelKey, { defaultValue: option.fallbackLabel })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}
            {connectAlibabaWorkspaceRequired ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-alibaba-workspace-id">{t('settings.alibabaWorkspaceId')}</Label>
                <DesktopFormInput
                  id="connect-alibaba-workspace-id"
                  value={connectAlibabaWorkspaceId}
                  onChange={(e) => setConnectAlibabaWorkspaceId(e.target.value)}
                  placeholder={t('settings.alibabaWorkspaceIdPlaceholder')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider && providerShowsConnectTransportPicker(selectedProvider) ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-transport">{t('settings.apiType')}</Label>
                <div className={DESKTOP_FORM_INPUT_SHELL}>
                  <Select
                    value={connectTransportKind}
                    onValueChange={(value) => setConnectTransportKind(value as DesktopTransportKind)}
                  >
                    <SelectTrigger
                      id="connect-api-transport"
                      className={DESKTOP_FORM_FIELD_TRIGGER_INNER}
                    >
                      <SelectValue />
                    </SelectTrigger>
                  <SelectContent>
                    {connectTransportOptionsForProvider(selectedProvider).map((option) => (
                      <SelectItem key={`${option.value}-${option.label}`} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                  </Select>
                </div>
                {(() => {
                  const transportSummary = connectTransportOptionsForProvider(selectedProvider)
                    .filter((option) => option.value === connectTransportKind)
                    .map((option) => connectTransportOptionSummary(option, selectedProvider))
                    .find(Boolean);
                  return transportSummary ? (
                    <p className="text-xs leading-5 text-muted-foreground">{transportSummary}</p>
                  ) : null;
                })()}
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label>{t('settings.modelAddMode')}</Label>
                <div
                  role="tablist"
                  aria-label={t('settings.modelAddMode')}
                  className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
                >
                  {(["single", "bulk"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={customConnectMode === value}
                      className={cn(
                        "rounded-md px-2.5 text-xs font-medium transition-colors",
                        customConnectMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setCustomConnectMode(value)}
                    >
                      {value === "single" ? t('settings.addSingle') : t('settings.addAll')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-model-name">{t('settings.modelName')}</Label>
                <DesktopFormInput
                  id="connect-model-name"
                  value={connectName}
                  onChange={(e) => setConnectName(e.target.value)}
                  placeholder={t('settings.modelNameExample')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label>{t('settings.modelCapabilities')}</Label>
                <ModelCapabilitiesCombobox
                  value={connectCapabilities}
                  disabled={modelsBusy || modelsPreviewBusy}
                  onChange={setConnectCapabilities}
                />
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-context-length">{t('settings.contextLength')}</Label>
                <DesktopFormInput
                  id="connect-context-length"
                  type="number"
                  min={1}
                  step={1}
                  value={connectContextLength}
                  onChange={(e) => setConnectContextLength(e.target.value)}
                  placeholder={t('settings.optional')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-base">{t('settings.endpoint')}</Label>
                <DesktopFormInput
                  id="connect-api-base"
                  value={connectApiBase}
                  onChange={(e) => setConnectApiBase(e.target.value)}
                  placeholder={t('settings.endpointPlaceholder')}
                  autoComplete="off"
                  required
                />
              </div>
            ) : null}
            {selectedProvider === "amazon-bedrock" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-aws-region">{t('settings.bedrockRegion')}</Label>
                <DesktopFormInput
                  id="connect-aws-region"
                  value={connectAwsRegion}
                  onChange={(e) => setConnectAwsRegion(e.target.value)}
                  placeholder={t('settings.bedrockRegionPlaceholder')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "amazon-bedrock" ? (
              <div className="grid gap-2">
                <Label>{t('settings.bedrockAuthMode')}</Label>
                <div
                  role="tablist"
                  aria-label={t('settings.bedrockAuthMode')}
                  className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
                >
                  {(["bearer", "iam"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={bedrockConnectMode === value}
                      className={cn(
                        "rounded-md px-2.5 text-xs font-medium transition-colors",
                        bedrockConnectMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setBedrockConnectMode(value)}
                    >
                      {value === "bearer"
                        ? t('settings.bedrockAuthBearer')
                        : t('settings.bedrockAuthIam')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-bedrock-model-name">{t('settings.modelName')}</Label>
                <DesktopFormInput
                  id="connect-bedrock-model-name"
                  value={connectName}
                  onChange={(e) => setConnectName(e.target.value)}
                  placeholder={t('settings.bedrockModelNamePlaceholder')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-context-length-bedrock">{t('settings.contextLength')}</Label>
                <DesktopFormInput
                  id="connect-context-length-bedrock"
                  type="number"
                  min={1}
                  step={1}
                  value={connectContextLength}
                  onChange={(e) => setConnectContextLength(e.target.value)}
                  placeholder={t('settings.optional')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "azure" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-azure-resource-name">{t('settings.azureResourceName')}</Label>
                <DesktopFormInput
                  id="connect-azure-resource-name"
                  value={connectAzureResourceName}
                  onChange={(e) => setConnectAzureResourceName(e.target.value)}
                  placeholder={t('settings.azureResourceNamePlaceholder')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "azure" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-azure-deployment-name">{t('settings.azureDeploymentName')}</Label>
                <DesktopFormInput
                  id="connect-azure-deployment-name"
                  value={connectName}
                  onChange={(e) => setConnectName(e.target.value)}
                  placeholder={t('settings.azureDeploymentNamePlaceholder')}
                  autoComplete="off"
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.azureSingleHint')}
                </p>
              </div>
            ) : null}
            {selectedProvider === "azure" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-context-length-azure">{t('settings.contextLength')}</Label>
                <DesktopFormInput
                  id="connect-context-length-azure"
                  type="number"
                  min={1}
                  step={1}
                  value={connectContextLength}
                  onChange={(e) => setConnectContextLength(e.target.value)}
                  placeholder={t('settings.optional')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {(selectedProvider !== "amazon-bedrock" || bedrockConnectMode === "bearer")
            && selectedProvider !== "google-vertex-ai" ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-api-key">
                {selectedProvider === "amazon-bedrock"
                  ? t('settings.bedrockApiKeyLabel')
                  : "API Key"}
              </Label>
              <DesktopFormInput
                id="connect-api-key"
                type="password"
                value={connectApiKey}
                onChange={(e) => setConnectApiKey(e.target.value)}
                placeholder={t('settings.enterApiKey')}
                autoComplete="off"
              />
              {selectedProvider === "amazon-bedrock" ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.bedrockBearerHint')}
                </p>
              ) : null}
            </div>
            ) : null}
            {selectedProvider === "amazon-bedrock" && bedrockConnectMode === "iam" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="connect-access-key-id">{t('settings.bedrockAccessKeyId')}</Label>
                  <DesktopFormInput
                    id="connect-access-key-id"
                    value={connectAccessKeyId}
                    onChange={(e) => setConnectAccessKeyId(e.target.value)}
                    placeholder={t('settings.enterApiKey')}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="connect-secret-access-key">{t('settings.bedrockSecretAccessKey')}</Label>
                  <DesktopFormInput
                    id="connect-secret-access-key"
                    type="password"
                    value={connectSecretAccessKey}
                    onChange={(e) => setConnectSecretAccessKey(e.target.value)}
                    placeholder={t('settings.enterApiKey')}
                    autoComplete="off"
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.bedrockIamHint')}
                </p>
              </>
            ) : null}
            {selectedProvider === "google-vertex-ai" ? (
              <div className="grid gap-2">
                <Label>{t('settings.vertexAuthMode')}</Label>
                <div
                  role="tablist"
                  aria-label={t('settings.vertexAuthMode')}
                  className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
                >
                  {(["adc", "service-account", "express"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={vertexConnectMode === value}
                      className={cn(
                        "rounded-md px-2.5 text-xs font-medium transition-colors",
                        vertexConnectMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      disabled={modelsBusy || modelsPreviewBusy}
                      onClick={() => setVertexConnectMode(value)}
                    >
                      {value === "adc"
                        ? t('settings.vertexAuthAdc')
                        : value === "service-account"
                          ? t('settings.vertexAuthServiceAccount')
                          : t('settings.vertexAuthExpress')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "google-vertex-ai" && vertexConnectMode === "express" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-vertex-api-key">API Key</Label>
                <DesktopFormInput
                  id="connect-vertex-api-key"
                  type="password"
                  value={connectApiKey}
                  onChange={(e) => setConnectApiKey(e.target.value)}
                  placeholder={t('settings.enterApiKey')}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "google-vertex-ai" && vertexConnectMode !== "express" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="connect-vertex-project">{t('settings.vertexProject')}</Label>
                  <DesktopFormInput
                    id="connect-vertex-project"
                    value={connectVertexProject}
                    onChange={(e) => setConnectVertexProject(e.target.value)}
                    placeholder={t('settings.vertexProjectPlaceholder')}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="connect-vertex-location">{t('settings.vertexLocation')}</Label>
                  <DesktopFormInput
                    id="connect-vertex-location"
                    value={connectVertexLocation}
                    onChange={(e) => setConnectVertexLocation(e.target.value)}
                    placeholder={t('settings.vertexLocationPlaceholder')}
                    autoComplete="off"
                  />
                </div>
              </>
            ) : null}
            {selectedProvider === "google-vertex-ai" && vertexConnectMode === "adc" ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {t('settings.vertexAdcHint')}
              </p>
            ) : null}
            {selectedProvider === "google-vertex-ai" && vertexConnectMode === "express" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="connect-vertex-model-name">{t('settings.modelName')}</Label>
                  <DesktopFormInput
                    id="connect-vertex-model-name"
                    value={connectName}
                    onChange={(e) => setConnectName(e.target.value)}
                    placeholder={t('settings.vertexModelNamePlaceholder')}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="connect-context-length-vertex">{t('settings.contextLength')}</Label>
                  <DesktopFormInput
                    id="connect-context-length-vertex"
                    type="number"
                    min={1}
                    step={1}
                    value={connectContextLength}
                    onChange={(e) => setConnectContextLength(e.target.value)}
                    placeholder={t('settings.optional')}
                    autoComplete="off"
                  />
                </div>
              </>
            ) : null}
            {selectedProvider === "google-vertex-ai" && vertexConnectMode === "service-account" ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="connect-vertex-client-email">{t('settings.vertexClientEmail')}</Label>
                  <DesktopFormInput
                    id="connect-vertex-client-email"
                    value={connectVertexClientEmail}
                    onChange={(e) => setConnectVertexClientEmail(e.target.value)}
                    placeholder={t('settings.vertexClientEmailPlaceholder')}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="connect-vertex-private-key">{t('settings.vertexPrivateKey')}</Label>
                  <DesktopFormInput
                    id="connect-vertex-private-key"
                    type="password"
                    value={connectVertexPrivateKey}
                    onChange={(e) => setConnectVertexPrivateKey(e.target.value)}
                    placeholder={t('settings.enterApiKey')}
                    autoComplete="off"
                  />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.vertexServiceAccountHint')}
                </p>
              </>
            ) : null}
            <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConnectDialogOpen(false)}
                disabled={modelsBusy || modelsPreviewBusy}
              >
                {t('common.cancel')}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {selectedProvider === "custom" && customConnectMode === "single" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy ||
                      modelsPreviewBusy ||
                      !connectName.trim() ||
                      !connectApiBase.trim() ||
                      !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await saveCustomSingle();
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('settings.addThisModel')}
                  </Button>
                ) : null}
                {selectedProvider === "custom" && customConnectMode === "bulk" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectApiBase.trim()
                      || !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(true);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
                {selectedProvider === "amazon-bedrock" && bedrockConnectMode === "bearer" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectAwsRegion.trim()
                      || !connectName.trim()
                      || !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await saveBedrockBearerSingle();
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('settings.addThisModel')}
                  </Button>
                ) : null}
                {selectedProvider === "amazon-bedrock" && bedrockConnectMode === "iam" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectAwsRegion.trim()
                      || !hasBedrockCatalogCredentials
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(false);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
                {selectedProvider === "google-vertex-ai" && vertexConnectMode === "express" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectName.trim()
                      || !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await saveVertexExpressSingle();
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('settings.addThisModel')}
                  </Button>
                ) : null}
                {selectedProvider === "google-vertex-ai" && vertexConnectMode !== "express" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectVertexProject.trim()
                      || !connectVertexLocation.trim()
                      || (vertexConnectMode === "service-account" && !hasVertexCatalogCredentials)
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(false);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
                {selectedProvider === "azure" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      modelsBusy
                      || modelsPreviewBusy
                      || !connectAzureResourceName.trim()
                      || !connectName.trim()
                      || !connectApiKey.trim()
                    }
                    onClick={() => {
                      void (async () => {
                        try {
                          await saveAzureSingle();
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {t('settings.addThisModel')}
                  </Button>
                ) : null}
                {selectedProvider !== null && selectedProvider !== "custom" && selectedProvider !== "amazon-bedrock" && selectedProvider !== "azure" && selectedProvider !== "google-vertex-ai" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={modelsBusy || modelsPreviewBusy || !connectApiKey.trim()}
                    onClick={() => {
                      void (async () => {
                        try {
                          await syncCatalogFromUpstream(false);
                        } catch {
                          /* runtimeError */
                        }
                      })();
                    }}
                  >
                    {modelsBusy || modelsPreviewBusy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                    {t('settings.addProvider')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

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
              <h1 className="mb-6 text-xl font-semibold tracking-tight text-foreground">
                {t(settingsPageTitleKey[tab])}
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
