import { markEdits, tokenize, type HunkData, type HunkTokens } from 'react-diff-view';

import { refractorLanguageForPath, toolDiffRefractor } from '@/lib/refractor-tool-diff';

export function tokenizeDiffHunks(
  hunks: HunkData[],
  languageId: string,
  oldSource?: string,
): HunkTokens | null {
  if (hunks.length === 0) {
    return null;
  }

  const enhancers = [markEdits(hunks, { type: 'block' })];
  const language = refractorLanguageForPath(languageId);

  if (language) {
    return tokenize(hunks, {
      highlight: true,
      refractor: toolDiffRefractor,
      language,
      ...(oldSource !== undefined ? { oldSource } : {}),
      enhancers,
    });
  }

  return tokenize(hunks, {
    highlight: false,
    enhancers,
  });
}
