import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSessionTitlePrompt,
  normalizeGeneratedSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
} from '@spirit-agent/host-internal';

test('buildSessionTitlePrompt includes user message and language rule', () => {
  const prompt = buildSessionTitlePrompt('帮我写一个 Desktop 会话标题功能');
  assert.match(prompt, /same language as the user message/i);
  assert.match(prompt, /帮我写一个 Desktop 会话标题功能/);
  assert.match(prompt, /"title"/);
});

test('normalizeGeneratedSessionTitle trims, strips quotes, and caps length', () => {
  const fallback = 'seed title';
  assert.equal(normalizeGeneratedSessionTitle('  hello world  ', fallback), 'hello world');
  assert.equal(normalizeGeneratedSessionTitle('"quoted title"', fallback), 'quoted title');
  assert.equal(normalizeGeneratedSessionTitle('', fallback), fallback);
  assert.equal(
    normalizeGeneratedSessionTitle('x'.repeat(SESSION_TITLE_MAX_LENGTH + 10), fallback).length,
    SESSION_TITLE_MAX_LENGTH + 1,
  );
});
