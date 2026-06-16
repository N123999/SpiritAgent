/** Renderer-safe Azure OpenAI resource / apiBase helpers（无 Node 或 SDK 依赖）。 */

const AZURE_RESOURCE_NAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])?$/;

export function normalizeAzureResourceName(resourceName: string): string {
  return resourceName.trim();
}

export function isValidAzureResourceName(resourceName: string): boolean {
  const normalized = normalizeAzureResourceName(resourceName);
  if (normalized.length < 2 || normalized.length > 64) {
    return false;
  }
  return AZURE_RESOURCE_NAME_PATTERN.test(normalized);
}

export function validateAzureResourceName(resourceName: string): string {
  const normalized = normalizeAzureResourceName(resourceName);
  if (!isValidAzureResourceName(normalized)) {
    throw new Error(
      'Azure OpenAI resource name must be 2–64 characters and contain only letters, numbers, and hyphens; it cannot start or end with a hyphen.',
    );
  }
  return normalized;
}

export function azureApiBaseFromResourceName(resourceName: string): string {
  const normalized = normalizeAzureResourceName(resourceName);
  if (!normalized) {
    return 'https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1';
  }
  return `https://${validateAzureResourceName(normalized)}.openai.azure.com/openai/v1`;
}

export function extractAzureResourceNameFromApiBase(baseUrl: string): string | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  const match = normalized.match(/^https:\/\/([^.]+)\.openai\.azure\.com(?:\/|$)/i);
  const resource = match?.[1]?.trim();
  if (!resource || !isValidAzureResourceName(resource)) {
    return undefined;
  }
  return resource;
}
