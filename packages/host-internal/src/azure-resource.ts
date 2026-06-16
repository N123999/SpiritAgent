/** Renderer-safe Azure OpenAI resource / apiBase helpers（无 Node 或 SDK 依赖）。 */

export function normalizeAzureResourceName(resourceName: string): string {
  return resourceName.trim();
}

export function azureApiBaseFromResourceName(resourceName: string): string {
  const normalized = normalizeAzureResourceName(resourceName);
  if (!normalized) {
    return 'https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1';
  }
  return `https://${normalized}.openai.azure.com/openai/v1`;
}

export function extractAzureResourceNameFromApiBase(baseUrl: string): string | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  const match = normalized.match(/^https:\/\/([^.]+)\.openai\.azure\.com(?:\/|$)/i);
  return match?.[1]?.trim() || undefined;
}
