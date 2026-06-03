import { createTwoFilesPatch } from 'diff';

/** 由 original/modified 生成 react-diff-view 可消费的 unified diff 文本。 */
export function buildToolCallUnifiedDiff(
  relativePath: string,
  original: string,
  modified: string,
): string {
  return createTwoFilesPatch(
    relativePath,
    relativePath,
    original,
    modified,
    '',
    '',
    { context: 3 },
  );
}
