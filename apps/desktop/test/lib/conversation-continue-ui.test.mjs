import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveTurnContinuePresentation,
  shouldShowContinueToolbarOnProcessGroup,
} from '../../src/lib/conversation-continue-ui.ts';

test('resolveTurnContinuePresentation anchors Continue on last assistant row when tools follow thinking', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, canContinue: true, aux: { thinking: 'plan' } },
    { id: 3, role: 'assistant', content: '', pending: false, tool: { toolName: 'read_file', phase: 'running', headline: 'x', detailLines: [] } },
    { id: 4, role: 'assistant', content: '', pending: false, tool: { toolName: 'glob', phase: 'preview', headline: 'y', detailLines: [] } },
  ];
  const resolved = resolveTurnContinuePresentation(messages);
  assert.ok(resolved);
  assert.equal(resolved.continuableMessage.id, 2);
  assert.equal(resolved.showContinueAtIndex, 3);
});

test('resolveTurnContinuePresentation anchors Continue on last row when timeline rows share message id', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 1, role: 'assistant', content: '', pending: false, aux: { thinking: 'plan' } },
    {
      id: 1,
      role: 'assistant',
      content: '',
      pending: false,
      canContinue: true,
      tool: { toolName: 'shell', phase: 'failed', headline: 'x', detailLines: [] },
    },
  ];
  const resolved = resolveTurnContinuePresentation(messages);
  assert.ok(resolved);
  assert.equal(resolved.showContinueAtIndex, 2);
});

test('resolveTurnContinuePresentation keeps Continue on last assistant body when present', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, canContinue: true, aux: { thinking: 'plan' } },
    { id: 3, role: 'assistant', content: 'Partial answer.', pending: false, canContinue: true },
  ];
  const resolved = resolveTurnContinuePresentation(messages);
  assert.ok(resolved);
  assert.equal(resolved.showContinueAtIndex, 2);
});

test('shouldShowContinueToolbarOnProcessGroup when continuable thinking is sealed in a process card', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, canContinue: true, aux: { thinking: 'plan' } },
    { id: 3, role: 'assistant', content: '', pending: false, tool: { toolName: 'glob', phase: 'running', headline: 'x', detailLines: [] } },
  ];
  const turnContinue = resolveTurnContinuePresentation(messages);
  assert.ok(turnContinue);
  assert.equal(
    shouldShowContinueToolbarOnProcessGroup([1, 2], messages, turnContinue, false, false),
    true,
  );
});
