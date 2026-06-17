import { useTranslation } from "react-i18next";

import { FontSelect } from "@/components/font-select";
import { themeSelectOptions } from "@/components/settings/constants";
import { SettingsRow } from "@/components/settings/settings-row";
import type { SettingsViewProps } from "@/components/settings/types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeLanguage, VALID_LANGUAGES } from "@/lib/i18n";
import { isNativeBackdropBlurSupported } from "@/lib/desktop-shell";
import type { ThemePreference } from "@/lib/theme";

export function AppearanceSettingsPanel({
  theme,
  onThemeChange,
  font,
  onFontChange,
  clickablePointerCursor,
  onClickablePointerCursorChange,
  settings,
  onSavePatch,
}: Pick<
  SettingsViewProps,
  | "theme"
  | "onThemeChange"
  | "font"
  | "onFontChange"
  | "clickablePointerCursor"
  | "onClickablePointerCursorChange"
  | "settings"
  | "onSavePatch"
>) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
      <SettingsRow
        label={t("settings.theme")}
        description={t("settings.themeDescription")}
        htmlFor="settings-theme-select"
      >
        <Select value={theme} onValueChange={(v) => onThemeChange(v as ThemePreference)}>
          <SelectTrigger id="settings-theme-select" className="w-full sm:min-w-[12rem]">
            <SelectValue placeholder={t("settings.selectTheme")} />
          </SelectTrigger>
          <SelectContent>
            {themeSelectOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t("settings.font")}
        description={t("settings.fontDescription")}
        htmlFor="settings-font-select"
      >
        <FontSelect id="settings-font-select" value={font} onValueChange={onFontChange} />
      </SettingsRow>

      <SettingsRow
        label={t("settings.uiLocale")}
        description={t("settings.uiLocaleDescription")}
        htmlFor="settings-locale"
      >
        <Select
          value={settings.uiLocale}
          onValueChange={(value) => {
            void changeLanguage(value);
            void onSavePatch({ uiLocale: value });
          }}
        >
          <SelectTrigger id="settings-locale" className="w-full sm:min-w-[12rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VALID_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang === "zh-CN" ? t("settings.langZhCN") : t("settings.langEn")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t("settings.blurEffect")}
        description={
          isNativeBackdropBlurSupported()
            ? t("settings.blurEffectDescription")
            : t("settings.blurEffectUnsupported")
        }
        htmlFor="settings-blur-effect"
      >
        {isNativeBackdropBlurSupported() ? (
          <div className="flex justify-end">
            <Checkbox
              id="settings-blur-effect"
              checked={settings.windowsMica}
              onCheckedChange={(value) => void onSavePatch({ windowsMica: value === true })}
              className="size-5"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground sm:text-right">—</p>
        )}
      </SettingsRow>

      <SettingsRow
        label={t("settings.clickablePointerCursor")}
        description={t("settings.clickablePointerCursorDescription")}
        htmlFor="settings-clickable-pointer-cursor"
      >
        <div className="flex justify-end">
          <Checkbox
            id="settings-clickable-pointer-cursor"
            checked={clickablePointerCursor}
            onCheckedChange={(value) => onClickablePointerCursorChange(value === true)}
            className="size-5"
          />
        </div>
      </SettingsRow>
    </div>
  );
}
