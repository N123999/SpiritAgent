const MODEL_DISPLAY_NAME_SEPARATOR_PATTERN = /[-:/]/g;

/** 将模型 id 格式化为展示名：`-`/`:`/` → 空格，各词首字母大写。 */
export function formatModelDisplayNameFromId(modelId: string): string {
  const normalized = modelId
    .trim()
    .replace(MODEL_DISPLAY_NAME_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return modelId;
  }

  return normalized
    .split(' ')
    .map((word) => {
      if (!word) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}
