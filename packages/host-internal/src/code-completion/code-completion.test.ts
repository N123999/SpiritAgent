import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CodeCompletionEditJournal } from './edit-journal.js';
import { buildCodeCompletionContextSlices } from './context.js';
import { buildCodeCompletionSystemSections, buildCodeCompletionUserPrompt } from './prompts.js';
import { CodeCompletionService } from './service.js';
import type { CodeCompletionRequestContext } from './types.js';

test('CodeCompletionEditJournal formats multi-file diffs and truncates', () => {
  const journal = new CodeCompletionEditJournal();
  journal.recordFileState({
    relativePath: 'src/a.ts',
    baselineText: 'const a = 1;',
    currentText: 'const a = 2;',
  });
  journal.recordFileState({
    relativePath: 'src/b.ts',
    baselineText: 'old',
    currentText: 'new',
  });

  const formatted = journal.formatRecentEdits(10_000);
  assert.match(formatted.text, /src\/a\.ts/);
  assert.match(formatted.text, /src\/b\.ts/);
  assert.equal(formatted.truncated, false);

  const tiny = journal.formatRecentEdits(20);
  assert.equal(tiny.truncated, true);
});

test('buildCodeCompletionContextSlices extracts prefix and suffix around cursor', () => {
  const text = 'line1\nline2\nline3';
  const slices = buildCodeCompletionContextSlices({
    documentText: text,
    cursorLine: 2,
    cursorColumn: 3,
  });
  assert.equal(slices.prefix, 'line1\nli');
  assert.equal(slices.suffix, 'ne2\nline3');
});

test('buildCodeCompletionSystemSections excludes tool agent host sections', () => {
  const sections = buildCodeCompletionSystemSections('mini-model');
  assert.equal(sections.length, 2);
  assert.match(sections[0] ?? '', /Spirit Agent/);
  assert.match(sections[1] ?? '', /code completion assistant/);
  assert.doesNotMatch(sections.join('\n'), /Available tools are defined/);
});

test('buildCodeCompletionTaskPrompt constrains inline replace near cursor', () => {
  const sections = buildCodeCompletionSystemSections('mini-model');
  const task = sections[1] ?? '';
  assert.match(task, /Inline replace preview is single-line only/);
  assert.match(task, /prefix of the replacement text/);
  assert.match(task, /include the cursor/);
  assert.match(task, /Insert may be multi-line ghost text/);
  assert.match(task, /Never duplicate the current line/);
  assert.match(task, /red delete highlight and a green side preview/);
  assert.match(task, /Multi-line delete is supported/);
  assert.match(task, /use delete only for pure removal/);
});

test('buildCodeCompletionTaskPrompt biases toward offering completions', () => {
  const sections = buildCodeCompletionSystemSections('mini-model');
  const task = sections[1] ?? '';
  assert.match(task, /Default to offering a completion/);
  assert.match(task, /You may complete markdown and docs/);
  assert.doesNotMatch(task, /continue README\/markdown prose/);
});

test('buildCodeCompletionUserPrompt includes recent edits block', () => {
  const prompt = buildCodeCompletionUserPrompt({
    context: {
      workspaceRoot: '/ws',
      relativePath: 'src/foo.ts',
      languageId: 'typescript',
      documentText: 'const x = 1;',
      cursorLine: 1,
      cursorColumn: 12,
    },
    recentEditsText: '--- src/foo.ts\n-old\n+new',
    recentEditsTruncated: true,
  });
  assert.match(prompt, /\[recent_edits\]/);
  assert.match(prompt, /truncated: true/);
});

test('CodeCompletionService returns empty operations when no llm deps', async () => {
  const service = new CodeCompletionService();
  const context: CodeCompletionRequestContext = {
    workspaceRoot: '/ws',
    relativePath: 'a.ts',
    languageId: 'typescript',
    documentText: 'x',
    cursorLine: 1,
    cursorColumn: 2,
  };
  const result = await service.request(context);
  assert.deepEqual(result, { operations: [] });
});
