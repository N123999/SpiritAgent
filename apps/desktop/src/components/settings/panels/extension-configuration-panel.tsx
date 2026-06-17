import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/settings-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DesktopFormInput } from "@/components/ui/desktop-form-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopExtensionListItem, UpdateExtensionSecretRequest, UpdateExtensionSettingsRequest } from "@/types";

export function ExtensionConfigurationPanel({
  item,
  extensionsBusy,
  onUpdateExtensionSettings,
  onUpdateExtensionSecret,
}: {
  item: DesktopExtensionListItem;
  extensionsBusy: boolean;
  onUpdateExtensionSettings: (request: UpdateExtensionSettingsRequest) => Promise<void>;
  onUpdateExtensionSecret: (request: UpdateExtensionSecretRequest) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});

  const settingDraftKey = (extensionId: string, key: string) => `${extensionId}::setting::${key}`;
  const secretDraftKey = (extensionId: string, key: string) => `${extensionId}::secret::${key}`;

  const updateSettingDraft = (extensionId: string, key: string, value: string) => {
    setSettingDrafts((current) => ({
      ...current,
      [settingDraftKey(extensionId, key)]: value,
    }));
  };

  const updateSecretDraft = (extensionId: string, key: string, value: string) => {
    setSecretDrafts((current) => ({
      ...current,
      [secretDraftKey(extensionId, key)]: value,
    }));
  };

  const currentSettingText = (
    item: DesktopExtensionListItem,
    key: string,
    fallback?: string | boolean | number,
  ): string => {
    const draft = settingDrafts[settingDraftKey(item.id, key)];
    if (draft !== undefined) {
      return draft;
    }

    const value = item.settingsValues?.[key] ?? fallback;
    return value === undefined || value === null ? "" : String(value);
  };

  const hasSettings = Boolean(item.settingsSchema?.length);
  const hasSecrets = Boolean(item.secretSlots?.length);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {item.desktopSettingsPage?.title ?? item.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {item.description ?? t('settings.extensionSettingsDescription', { id: item.id })}
        </p>
      </div>

      {!hasSettings && !hasSecrets ? (
        <div className="rounded-lg border border-border/40 bg-background/80 px-4 py-10 text-center text-sm text-muted-foreground">
          {t('settings.noExtensionSettings')}
        </div>
      ) : (
        <div className="divide-y divide-border/35 rounded-lg border border-border/40 bg-background/80 px-4 sm:px-5">
          {item.settingsSchema?.map((setting) => {
            const fieldKey = settingDraftKey(item.id, setting.key);
            const currentText = currentSettingText(item, setting.key, setting.defaultValue);

            if (setting.type === "boolean") {
              const checked = Boolean(
                item.settingsValues?.[setting.key] ?? setting.defaultValue ?? false,
              );
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <div className="flex justify-end">
                    <Checkbox
                      id={fieldKey}
                      checked={checked}
                      disabled={extensionsBusy}
                      onCheckedChange={(value) => {
                        void onUpdateExtensionSettings({
                          id: item.id,
                          values: { [setting.key]: value === true },
                        });
                      }}
                      className="size-5"
                    />
                  </div>
                </SettingsRow>
              );
            }

            if (setting.type === "select") {
              const selected = currentText || String(setting.defaultValue ?? "");
              return (
                <SettingsRow
                  key={fieldKey}
                  label={setting.title}
                  description={setting.description}
                  htmlFor={fieldKey}
                >
                  <Select
                    value={selected}
                    onValueChange={(value) => {
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value || null },
                      });
                    }}
                    disabled={extensionsBusy}
                  >
                    <SelectTrigger id={fieldKey} className="w-full sm:min-w-[14rem]">
                      <SelectValue placeholder={setting.placeholder ?? setting.title} />
                    </SelectTrigger>
                    <SelectContent>
                      {setting.options?.map((option) => (
                        <SelectItem key={`${fieldKey}:${option.value}`} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsRow>
              );
            }

            return (
              <SettingsRow
                key={fieldKey}
                label={setting.title}
                description={setting.description}
                htmlFor={fieldKey}
              >
                <div className="flex w-full gap-2 sm:max-w-md">
                  <DesktopFormInput
                    id={fieldKey}
                    shellClassName="min-w-0 flex-1"
                    value={currentText}
                    disabled={extensionsBusy}
                    type={setting.type === "number" ? "number" : "text"}
                    placeholder={setting.placeholder ?? setting.title}
                    onChange={(event) => updateSettingDraft(item.id, setting.key, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionsBusy}
                    onClick={() => {
                      const raw = settingDrafts[fieldKey] ?? currentText;
                      const value =
                        setting.type === "number"
                          ? raw.trim().length === 0
                            ? null
                            : Number(raw)
                          : raw.trim().length === 0
                            ? null
                            : raw;
                      void onUpdateExtensionSettings({
                        id: item.id,
                        values: { [setting.key]: value },
                      });
                    }}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}

          {item.secretSlots?.map((slot) => {
            const fieldKey = secretDraftKey(item.id, slot.key);
            const configured = item.secretStatuses?.find((entry) => entry.key === slot.key)?.configured === true;
            return (
              <SettingsRow
                key={fieldKey}
                label={slot.title}
                description={slot.description}
                htmlFor={fieldKey}
              >
                <div className="flex w-full flex-wrap justify-end gap-2 sm:max-w-md">
                  <Badge variant={configured ? "secondary" : "outline"} className="h-9 px-3 text-muted-foreground">
                    {configured ? t('settings.configured') : t('settings.notConfigured')}
                  </Badge>
                  <DesktopFormInput
                    id={fieldKey}
                    shellClassName="min-w-0 flex-1"
                    type="password"
                    value={secretDrafts[fieldKey] ?? ""}
                    disabled={extensionsBusy}
                    placeholder={configured ? t('settings.enterNewValue') : t('settings.enterSecret')}
                    onChange={(event) => updateSecretDraft(item.id, slot.key, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionsBusy}
                    onClick={() => {
                      void onUpdateExtensionSecret({
                        id: item.id,
                        key: slot.key,
                        value: secretDrafts[fieldKey] ?? "",
                      });
                      updateSecretDraft(item.id, slot.key, "");
                    }}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={extensionsBusy || !configured}
                    onClick={() => {
                      void onUpdateExtensionSecret({
                        id: item.id,
                        key: slot.key,
                        value: "",
                      });
                      updateSecretDraft(item.id, slot.key, "");
                    }}
                  >
                    {t('common.clear')}
                  </Button>
                </div>
              </SettingsRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
