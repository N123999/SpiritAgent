import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyCodeCompletionOperations,
  buildCodeCompletionIdentityPrompt,
  codeCompletionToMonacoItems,
  validateCodeCompletionOutput,
} from '../../dist/code-completion/index.js';

test('buildCodeCompletionIdentityPrompt includes model and CJK guidance', () => {
  const prompt = buildCodeCompletionIdentityPrompt('gpt-test');
  assert.match(prompt, /You are Spirit Agent/);
  assert.match(prompt, /gpt-test/);
  assert.match(prompt, /CJK/);
});

test('validateCodeCompletionOutput accepts empty operations', () => {
  const result = validateCodeCompletionOutput({ operations: [] });
  assert.deepEqual(result, { operations: [] });
});

test('validateCodeCompletionOutput accepts insert at cursor', () => {
  const result = validateCodeCompletionOutput({
    operations: [
      {
        kind: 'insert',
        startLine: 2,
        startColumn: 5,
        endLine: 2,
        endColumn: 5,
        text: 'foo',
      },
    ],
  });
  assert.deepEqual(result?.operations[0]?.text, 'foo');
});

test('validateCodeCompletionOutput rejects insert with mismatched range', () => {
  const result = validateCodeCompletionOutput({
    operations: [
      {
        kind: 'insert',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
        text: 'x',
      },
    ],
  });
  assert.equal(result, undefined);
});

test('applyCodeCompletionOperations insert append', () => {
  const text = 'line1\nline2';
  const next = applyCodeCompletionOperations(text, [
    {
      kind: 'insert',
      startLine: 2,
      startColumn: 6,
      endLine: 2,
      endColumn: 6,
      text: '!',
    },
  ]);
  assert.equal(next, 'line1\nline2!');
});

test('applyCodeCompletionOperations replace span', () => {
  const text = 'const foo = 1;';
  const next = applyCodeCompletionOperations(text, [
    {
      kind: 'replace',
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 10,
      text: 'bar',
    },
  ]);
  assert.equal(next, 'const bar = 1;');
});

test('applyCodeCompletionOperations delete span', () => {
  const text = 'remove me';
  const next = applyCodeCompletionOperations(text, [
    {
      kind: 'delete',
      startLine: 1,
      startColumn: 8,
      endLine: 1,
      endColumn: 11,
    },
  ]);
  assert.equal(next, 'remove ');
});

test('codeCompletionToMonacoItems maps insert to inline item', () => {
  const items = codeCompletionToMonacoItems([
    {
      kind: 'insert',
      startLine: 1,
      startColumn: 4,
      endLine: 1,
      endColumn: 4,
      text: 'bar',
    },
  ]);
  assert.deepEqual(items[0], {
    startLineNumber: 1,
    startColumn: 4,
    endLineNumber: 1,
    endColumn: 4,
    insertText: 'bar',
  });
});
