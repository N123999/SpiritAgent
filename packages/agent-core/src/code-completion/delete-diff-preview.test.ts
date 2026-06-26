import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDeletePreviewText,
  codeCompletionOperationToDeleteDiffPreviewAtCursor,
  extractTextInRange,
  isCursorInDeleteRange,
} from './delete-diff-preview.js';
import type { CodeCompletionOperation } from './types.js';

test('isCursorInDeleteRange accepts cursor inside multi-line span', () => {
  const op = {
    startLine: 2,
    startColumn: 3,
    endLine: 4,
    endColumn: 5,
  };
  assert.equal(isCursorInDeleteRange(op, 2, 3), true);
  assert.equal(isCursorInDeleteRange(op, 3, 1), true);
  assert.equal(isCursorInDeleteRange(op, 4, 5), true);
  assert.equal(isCursorInDeleteRange(op, 1, 1), false);
  assert.equal(isCursorInDeleteRange(op, 5, 1), false);
  assert.equal(isCursorInDeleteRange(op, 2, 2), false);
  assert.equal(isCursorInDeleteRange(op, 4, 6), false);
});

test('extractTextInRange reads span text for delete', () => {
  const documentText = '## 最-后';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 5,
    endLine: 1,
    endColumn: 6,
  };
  assert.equal(extractTextInRange(documentText, operation), '-');
});

test('buildDeletePreviewText maps single-line hyphen removal', () => {
  const documentText = '## 最-后';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 5,
    endLine: 1,
    endColumn: 6,
  };
  assert.equal(buildDeletePreviewText(documentText, operation), '## 最后');
});

test('buildDeletePreviewText maps cross-line delete', () => {
  const documentText = 'foo\nbar\nbaz';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 1,
    endLine: 2,
    endColumn: 4,
  };
  assert.equal(buildDeletePreviewText(documentText, operation), '\nbaz');
});

test('codeCompletionOperationToDeleteDiffPreviewAtCursor rejects cursor outside span', () => {
  const documentText = '## 最-后';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 5,
    endLine: 1,
    endColumn: 6,
  };
  assert.equal(
    codeCompletionOperationToDeleteDiffPreviewAtCursor(operation, {
      documentText,
      cursorLine: 1,
      cursorColumn: 3,
    }),
    undefined,
  );
});

test('codeCompletionOperationToDeleteDiffPreviewAtCursor returns spec at cursor', () => {
  const documentText = '## 最-后';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 5,
    endLine: 1,
    endColumn: 6,
  };
  const spec = codeCompletionOperationToDeleteDiffPreviewAtCursor(operation, {
    documentText,
    cursorLine: 1,
    cursorColumn: 5,
  });
  assert.deepEqual(spec, {
    startLineNumber: 1,
    startColumn: 5,
    endLineNumber: 1,
    endColumn: 6,
    deletedText: '-',
    previewText: '## 最后',
    anchorLineNumber: 1,
  });
});

test('codeCompletionOperationToDeleteDiffPreviewAtCursor allows empty previewText', () => {
  const documentText = 'only';
  const operation: CodeCompletionOperation = {
    kind: 'delete',
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 5,
  };
  const spec = codeCompletionOperationToDeleteDiffPreviewAtCursor(operation, {
    documentText,
    cursorLine: 1,
    cursorColumn: 3,
  });
  assert.ok(spec);
  assert.equal(spec?.previewText, '');
  assert.equal(spec?.deletedText, 'only');
});
