/** Google Vertex AI 端点派生（无 SDK 依赖）。 */

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function normalizeVertexLocation(location: string): string {
  return location.trim().toLowerCase();
}

export function normalizeVertexProject(project: string): string {
  return project.trim();
}

export function vertexApiBaseFromProjectAndLocation(project: string, location: string): string {
  const normalizedProject = normalizeVertexProject(project);
  const normalizedLocation = normalizeVertexLocation(location);
  if (!normalizedProject || !normalizedLocation) {
    return 'https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1';
  }

  const baseHost =
    normalizedLocation === 'global'
      ? 'aiplatform.googleapis.com'
      : `${normalizedLocation}-aiplatform.googleapis.com`;
  return `https://${baseHost}/v1/projects/${normalizedProject}/locations/${normalizedLocation}`;
}

/** Vertex publisher models 列表 URL（`.../publishers/google/models`）。 */
export function vertexPublisherModelsListUrl(
  project: string,
  location: string,
  pageToken?: string,
): string {
  const base = trimTrailingSlashes(vertexApiBaseFromProjectAndLocation(project, location));
  const url = new URL(`${base}/publishers/google/models`);
  url.searchParams.set('pageSize', '100');
  if (pageToken && pageToken.trim().length > 0) {
    url.searchParams.set('pageToken', pageToken.trim());
  }
  return url.toString();
}

export function extractVertexProjectAndLocationFromApiBase(
  baseUrl: string,
): { project?: string; location?: string } {
  const normalized = trimTrailingSlashes(baseUrl);
  const match = normalized.match(
    /^https:\/\/(?:([a-z0-9-]+)-)?aiplatform\.googleapis\.com\/v1\/projects\/([^/]+)\/locations\/([^/]+)/i,
  );
  if (!match) {
    return {};
  }

  const [, locationPrefix, project, location] = match;
  const resolvedLocation =
    locationPrefix && locationPrefix.length > 0 ? locationPrefix.toLowerCase() : location?.toLowerCase();
  return {
    ...(project ? { project } : {}),
    ...(resolvedLocation ? { location: resolvedLocation } : {}),
  };
}
