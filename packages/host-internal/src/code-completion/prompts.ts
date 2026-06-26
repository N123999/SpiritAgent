import { buildCodeCompletionIdentityPrompt } from '@spirit-agent/core';

import { buildCodeCompletionContextSlices } from './context.js';
import type { CodeCompletionRequestContext } from './types.js';

export function buildCodeCompletionTaskPrompt(): string {
  return [
    'You are a code completion assistant for the Spirit Agent editor.',
    'Return only JSON matching the code_completion schema. No Markdown fences or prose.',
    'Default to offering a completion. Prefer insert at the cursor with the next tokens the user is likely typing.',
    'Use operations[] to describe edits relative to the provided cursor and document snapshot.',
    '- insert: append text at cursor (startLine/startColumn equals endLine/endColumn); use \\n for additional lines when completing blocks.',
    '- replace: change an existing single-line span to text; the span must include the cursor (cursor inside the span or at its end column).',
    '- delete: remove a span (omit text or use empty string). The editor shows a red delete highlight and a green side preview; Tab accepts. Multi-line delete is supported.',
    'Inline replace preview is single-line only; the span text must be a prefix of the replacement text (extend or append; do not rewrite from the middle).',
    'Prefer replace when extending existing text on the line; use delete only for pure removal.',
    'Insert may be multi-line ghost text (e.g. after { on a block starter, complete the indented body and closing brace).',
    'Prefer the shortest replace span near the cursor. To insert before a character, use insert at that column rather than replace.',
    'Complete partial identifiers, keywords, operators, and closing delimiters when [prefix] or [recent_edits] make the intent clear.',
    'You may complete markdown and docs (.md, .mdx) on the current line when style matches [prefix].',
    'Continue obvious local patterns; match indentation, quotes, semicolons, and naming already in the file.',
    'Keep single-line insert concise; for block bodies use multi-line insert with indentation matching [prefix].',
    'Never duplicate the current line or repeat content already in [suffix]. Do not append an entire line at the cursor when the fix belongs earlier on the same line.',
    'Return {"operations":[]} only when the cursor is on a finished statement and no sensible next token exists.',
    'Do not wrap output in comments or repeat large unchanged regions.',
  ].join('\n');
}

export function buildCodeCompletionSystemSections(modelName: string): string[] {
  return [buildCodeCompletionIdentityPrompt(modelName), buildCodeCompletionTaskPrompt()];
}

export function buildCodeCompletionUserPrompt(input: {
  context: CodeCompletionRequestContext;
  recentEditsText: string;
  recentEditsTruncated?: boolean;
}): string {
  const { context, recentEditsText, recentEditsTruncated = false } = input;
  const slices = buildCodeCompletionContextSlices({
    documentText: context.documentText,
    cursorLine: context.cursorLine,
    cursorColumn: context.cursorColumn,
  });

  const blocks = [
    '[file]',
    `relativePath: ${context.relativePath}`,
    `languageId: ${context.languageId}`,
    '',
    '[cursor]',
    `line: ${context.cursorLine}`,
    `column: ${context.cursorColumn}`,
    '',
    '[prefix]',
    slices.prefixTruncated ? '(truncated)\n' + slices.prefix : slices.prefix,
    '',
    '[suffix]',
    slices.suffixTruncated ? slices.suffix + '\n(truncated)' : slices.suffix,
    '',
    '[recent_edits]',
    recentEditsTruncated ? `${recentEditsText}\ntruncated: true` : recentEditsText,
  ];

  const related = context.relatedSnippets ?? [];
  if (related.length > 0) {
    blocks.push('', '[related]');
    for (const snippet of related) {
      blocks.push(`--- ${snippet.relativePath} ---`, snippet.content, '');
    }
  }

  return blocks.join('\n');
}
