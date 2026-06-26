export type GrepRequestFields = {
  query?: string;
  is_regexp?: boolean;
  glob?: string;
};

export function parseGrepRequestFromArgsExcerpt(
  argsExcerpt: string | undefined,
): GrepRequestFields | undefined {
  const excerpt = argsExcerpt?.trim();
  if (!excerpt) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(excerpt) as Record<string, unknown>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : undefined,
      is_regexp: parsed.is_regexp === true,
      glob: typeof parsed.glob === 'string' ? parsed.glob : undefined,
    };
  } catch {
    return undefined;
  }
}

export function grepToolHeadlineDetail(
  request: GrepRequestFields,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | undefined {
  const query = request.query?.trim() ?? '';
  const glob = request.glob?.trim() ?? '';
  const prefix = request.is_regexp === true ? t('tool.regexPrefix') : '';
  const queryLabel = `${prefix}${query}`;
  if (queryLabel && glob) {
    return t('tool.searchQueryInGlob', { query: queryLabel, glob });
  }
  return queryLabel || glob || undefined;
}
