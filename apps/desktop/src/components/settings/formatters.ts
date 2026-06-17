import i18n from "@/lib/i18n";

export function formatExtensionInstalledAt(unixMs: number): string {
  return new Date(unixMs).toLocaleString("zh-CN", {
    hour12: false,
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(i18n.t("settings.readFileFailed")));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(i18n.t("settings.readFileFailed")));
        return;
      }
      const marker = "base64,";
      const markerIndex = reader.result.indexOf(marker);
      resolve(markerIndex >= 0 ? reader.result.slice(markerIndex + marker.length) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatSettingsTime(unixMs?: number): string {
  if (typeof unixMs !== "number") {
    return "—";
  }
  return new Date(unixMs).toLocaleString("zh-CN", { hour12: false });
}
