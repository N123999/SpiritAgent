import { buildCodeCompletionIdentityPrompt } from '@spirit-agent/core';

import { buildCodeCompletionContextSlices } from './context.js';
import type { CodeCompletionRequestContext } from './types.js';

export function buildCodeCompletionTaskPrompt(): string {
  return [
    'You are a code completion assistant for the Spirit Agent editor.',
    'Return only JSON matching the code_completion schema. No Markdown fences or prose.',
    'Use operations[] to describe edits relative to the provided cursor and document snapshot.',
    '- insert: append text at cursor (startLine/startColumn equals endLine/endColumn).',
    '- replace: change an existing single-line span to text; the span must include the cursor (cursor inside the span or at its end column).',
    '- delete: remove a span (omit text or use empty string).',
    'Inline preview only supports single-line edits. For replace, the span text must be a prefix of the replacement text (extend or append; do not rewrite from the middle).',
    'Prefer the shortest replace span near the cursor. To insert before a character, use insert at that column rather than replace.',
    'Never duplicate the current line or repeat content already in [suffix]. Do not append an entire line at the cursor when the fix belongs earlier on the same line.',
    'Prefer minimal, idiomatic completions matching local style and indentation.',
    'Match string quotes, semicolons, and naming already present in the file.',
    'If uncertain or nothing useful to add, return {"operations":[]}.',
    'Do not wrap output in comments, repeat large unchanged regions, or continue README/markdown prose.',
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
