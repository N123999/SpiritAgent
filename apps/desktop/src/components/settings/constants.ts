import type { SettingsSidebarTab } from "@/components/session-sidebar";
import type { ThemePreference } from "@/lib/theme";

export const settingsPageTitleKey: Record<SettingsSidebarTab, string> = {
  models: "settings.models",
  agents: "settings.agents",
  extensions: "settings.extensions",
  mcps: "settings.mcps",
  hooks: "settings.hooks",
  skills: "settings.skills",
  rules: "settings.rules",
  dreams: "settings.dreams",
  appearance: "settings.appearance",
  networks: "settings.networks",
  integrations: "settings.integrations",
  developer: "settings.developer",
};

export const themeSelectOptions: Array<{ value: ThemePreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" },
];

export const llmHttpVersionSelectOptions = [
  { value: "http1.1" as const, labelKey: "settings.llmHttpVersionHttp11" },
  { value: "http2" as const, labelKey: "settings.llmHttpVersionHttp2" },
];
