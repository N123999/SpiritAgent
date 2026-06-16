/** Renderer-safe OpenAI API base helpers（无 Node / SDK 依赖）。 */

/** Trim and remove trailing slashes from API root (e.g. `https://host/v1`). */
export function normalizeOpenAiApiBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
