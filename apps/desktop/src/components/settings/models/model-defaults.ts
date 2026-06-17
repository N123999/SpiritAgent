import i18n from "@/lib/i18n";
import type { DesktopModelCapability, DesktopSnapshot } from "@/types";

export const defaultCustomModelCapabilities: DesktopModelCapability[] = ["chat", "image"];

export type SettingsModelProfile = DesktopSnapshot["config"]["models"][number];

export type ModelDefaultAssignments = {
  activeModel: boolean;
  imageGenerationModel: boolean;
  videoGenerationModel: boolean;
  lightweightChatModel: boolean;
};

export type ModelDefaultRole = keyof ModelDefaultAssignments;

export const modelCapabilityOptions: Array<{
  value: DesktopModelCapability;
  label: string;
  labelKey: string;
  summaryKey: string;
}> = [
  { value: "chat", label: "Chat", labelKey: 'settings.capabilityChatLabel', summaryKey: 'settings.capabilityChat' },
  { value: "image", label: "Image", labelKey: 'settings.capabilityImageLabel', summaryKey: 'settings.capabilityImage' },
  { value: "video", label: "Video", labelKey: 'settings.capabilityVideoLabel', summaryKey: 'settings.capabilityVideo' },
  { value: "imageGeneration", label: "Image generation", labelKey: 'settings.capabilityImageGenerationLabel', summaryKey: 'settings.capabilityImageGeneration' },
  { value: "videoGeneration", label: "Video generation", labelKey: 'settings.capabilityVideoGenerationLabel', summaryKey: 'settings.capabilityVideoGeneration' },
];

export function normalizeModelCapabilitySelection(
  values: readonly DesktopModelCapability[],
): DesktopModelCapability[] {
  const allowed = new Set(modelCapabilityOptions.map((option) => option.value));
  const seen = new Set<DesktopModelCapability>();
  const normalized: DesktopModelCapability[] = [];
  for (const value of values) {
    if (!allowed.has(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...defaultCustomModelCapabilities];
}

export function canAssignAsActiveModel(
  model: SettingsModelProfile,
  isCurrentActiveModel: boolean,
): boolean {
  return isCurrentActiveModel || model.capabilities === undefined || model.capabilities.includes("chat");
}

export function canAssignAsImageGenerationModel(
  model: SettingsModelProfile,
  isCurrentImageGenerationModel: boolean,
): boolean {
  return isCurrentImageGenerationModel || model.capabilities?.includes("imageGeneration") === true;
}

export function canAssignAsVideoGenerationModel(
  model: SettingsModelProfile,
  isCurrentVideoGenerationModel: boolean,
): boolean {
  return isCurrentVideoGenerationModel || model.capabilities?.includes("videoGeneration") === true;
}

export function canAssignAsLightweightChatModel(
  model: SettingsModelProfile,
  isCurrentLightweightChatModel: boolean,
): boolean {
  return canAssignAsActiveModel(model, isCurrentLightweightChatModel);
}

export function getSupportedModelDefaultRoles(
  model: SettingsModelProfile,
  activeModel: string,
  imageGenerationModel: string,
  videoGenerationModel: string,
  lightweightChatModel: string,
): ModelDefaultRole[] {
  const roles: ModelDefaultRole[] = [];

  if (canAssignAsActiveModel(model, model.name === activeModel)) {
    roles.push("activeModel");
  }

  if (canAssignAsImageGenerationModel(model, model.name === imageGenerationModel)) {
    roles.push("imageGenerationModel");
  }

  if (canAssignAsVideoGenerationModel(model, model.name === videoGenerationModel)) {
    roles.push("videoGenerationModel");
  }

  if (canAssignAsLightweightChatModel(model, model.name === lightweightChatModel)) {
    roles.push("lightweightChatModel");
  }

  return roles;
}

export function modelDefaultActionLabel(roles: readonly ModelDefaultRole[]): string {
  if (roles.length === 0) {
    return i18n.t('settings.noDefaultRoles');
  }

  if (roles.length === 1) {
    if (roles[0] === "activeModel") {
      return i18n.t('settings.setActiveModel');
    }
    if (roles[0] === "imageGenerationModel") {
      return i18n.t('settings.setImageGenModel');
    }
    if (roles[0] === "videoGenerationModel") {
      return i18n.t('settings.setVideoGenModel');
    }
    return i18n.t('settings.setLightweightChatModel');
  }

  return i18n.t('settings.selectDefaultRole');
}
