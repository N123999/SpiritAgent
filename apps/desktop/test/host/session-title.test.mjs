import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSessionTitlePrompt,
  normalizeGeneratedSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
} from '@spirit-agent/host-internal';
import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import {
  countUserMessages,
  prepareSessionTitleForFirstUserTurn,
} from '../../dist-electron/src/host/session-title-first-turn.js';
import { createEmptySessionBundle } from '../../dist-electron/src/host/session-bundle.js';

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

test('prepareSessionTitleForFirstUserTurn resets llm title state before the first user turn', () => {
  const bundle = createEmptySessionBundle('/tmp/workspace');
  bundle.activeSession = {
    filePath: '/tmp/workspace/session.json',
    displayName: 'Old LLM title',
    kind: 'stored',
  };
  bundle.sessionTitleSource = 'llm';

  const prepared = prepareSessionTitleForFirstUserTurn(bundle, 'Rewritten first message');

  assert.equal(prepared, true);
  assert.equal(bundle.sessionTitleSource, 'seed');
  assert.equal(bundle.activeSession.displayName, 'Rewritten first message');
});

test('prepareSessionTitleForFirstUserTurn is a no-op when user messages already exist', () => {
  const bundle = createEmptySessionBundle('/tmp/workspace');
  bundle.activeSession = {
    filePath: '/tmp/workspace/session.json',
    displayName: 'Existing title',
    kind: 'stored',
  };
  bundle.sessionTitleSource = 'llm';
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn('First message');
  bundle.messageTimeline = timeline;
  bundle.messages = timeline.toMessages();

  const prepared = prepareSessionTitleForFirstUserTurn(bundle, 'Second message');

  assert.equal(prepared, false);
  assert.equal(bundle.sessionTitleSource, 'llm');
  assert.equal(bundle.activeSession.displayName, 'Existing title');
  assert.equal(countUserMessages(bundle), 1);
});
