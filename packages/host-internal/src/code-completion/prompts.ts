import { buildCodeCompletionIdentityPrompt } from '@spirit-agent/core';

import { buildCodeCompletionContextSlices } from './context.js';
import type { CodeCompletionRequestContext } from './types.js';

export function buildCodeCompletionTaskPrompt(): string {
  return [
    'You are a code completion assistant for the Spirit Agent editor.',
    'Return only JSON matching the code_completion schema. No Markdown fences or prose.',
    'Use operations[] to describe edits relative to the provided cursor and document snapshot.',
    '- insert: append text at cursor (startLine/startColumn equals endLine/endColumn).',
    '- replace: change an existing span to text.',
    '- delete: remove a span (omit text or use empty string).',
    'Prefer minimal, idiomatic completions matching local style and indentation.',
    'Match string quotes, semicolons, and naming already present in the file.',
    'If uncertain or nothing useful to add, return {"operations":[]}.',
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
