/** Gemini API（AI Studio）OpenAI 兼容 Chat Completions base。 */
export const GOOGLE_GEMINI_OPENAI_COMPAT_BASE =
  'https://generativelanguage.googleapis.com/v1beta/openai';

/** Gemini API 原生 REST root（模型目录等）。 */
export const GOOGLE_GEMINI_NATIVE_API_ROOT =
  'https://generativelanguage.googleapis.com/v1beta';

// 本机/CI 通常无法直连 generativelanguage.googleapis.com；联调需在有网络的环境手动验证连接向导。

const GOOGLE_GEMINI_HOST = 'generativelanguage.googleapis.com';

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

/** 是否为 Gemini API（generativelanguage.googleapis.com）端点。 */
export function isGoogleGeminiGenerativeLanguageApiBase(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    const url = new URL(trimTrailingSlashes(trimmed));
    return url.hostname === GOOGLE_GEMINI_HOST;
  } catch {
    return false;
  }
}

/** @throws 非 Gemini API 主机时抛出中文错误。 */
export function assertGoogleGeminiApiBase(baseUrl: string): void {
  if (!isGoogleGeminiGenerativeLanguageApiBase(baseUrl)) {
    throw new Error(
      'Google 提供商端点必须是 generativelanguage.googleapis.com（Gemini API）。',
    );
  }
}

function resolveGoogleNativeApiRoot(apiBase: string): string {
  assertGoogleGeminiApiBase(apiBase);
  const normalized = trimTrailingSlashes(apiBase);
  if (normalized.endsWith('/openai')) {
    return normalized.slice(0, -'/openai'.length);
  }
  if (normalized.endsWith('/v1beta')) {
    return normalized;
  }
  return GOOGLE_GEMINI_NATIVE_API_ROOT;
}

/** 由 Chat apiBase 派生原生 `GET /v1beta/models` URL。 */
export function googleNativeModelsListUrl(apiBase: string, pageToken?: string): string {
  const root = resolveGoogleNativeApiRoot(apiBase);
  const url = new URL(`${root}/models`);
  url.searchParams.set('pageSize', '1000');
  if (pageToken && pageToken.trim().length > 0) {
    url.searchParams.set('pageToken', pageToken.trim());
  }
  return url.toString();
}
