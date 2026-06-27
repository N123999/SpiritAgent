import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findEarliestContextBlockIndex,
  includesLlmContextBlock,
  LLM_CONTEXT_TAGS,
  unwrapLlmContextBlock,
  wrapLlmContextBlock,
} from './llm-context-block.js';

test('wrapLlmContextBlock wraps body with open and close tags', () => {
  const wrapped = wrapLlmContextBlock(LLM_CONTEXT_TAGS.rules, 'line one\nline two\n');
  assert.equal(wrapped, '<rules>\nline one\nline two\n</rules>');
});

test('unwrapLlmContextBlock extracts inner body', () => {
  const wrapped = wrapLlmContextBlock(LLM_CONTEXT_TAGS.agent_mode, 'You are in Agent mode.');
  assert.equal(
    unwrapLlmContextBlock(LLM_CONTEXT_TAGS.agent_mode, wrapped),
    'You are in Agent mode.',
  );
});

test('unwrapLlmContextBlock returns undefined when tag is absent', () => {
  assert.equal(unwrapLlmContextBlock(LLM_CONTEXT_TAGS.dreams, 'plain text'), undefined);
});

test('includesLlmContextBlock detects opening tag', () => {
  const wrapped = wrapLlmContextBlock(LLM_CONTEXT_TAGS.basic_info, 'Basic information');
  assert.equal(includesLlmContextBlock(wrapped, LLM_CONTEXT_TAGS.basic_info), true);
  assert.equal(includesLlmContextBlock('no tags here', LLM_CONTEXT_TAGS.basic_info), false);
});

test('findEarliestContextBlockIndex returns earliest tag position', () => {
  const content = [
    wrapLlmContextBlock(LLM_CONTEXT_TAGS.dreams, 'dream body'),
    '',
    wrapLlmContextBlock(LLM_CONTEXT_TAGS.basic_info, 'info body'),
  ].join('\n\n');

  const dreamsIndex = content.indexOf('<dreams>');
  const basicInfoIndex = content.indexOf('<basic_info>');
  assert.equal(
    findEarliestContextBlockIndex(content, [
      LLM_CONTEXT_TAGS.basic_info,
      LLM_CONTEXT_TAGS.dreams,
    ]),
    Math.min(dreamsIndex, basicInfoIndex),
  );
});

test('findEarliestContextBlockIndex returns -1 when no tags match', () => {
  assert.equal(findEarliestContextBlockIndex('plain', [LLM_CONTEXT_TAGS.rules]), -1);
});
