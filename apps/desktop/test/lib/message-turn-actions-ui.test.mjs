import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findLastAssistantBodyTextIndexInTurn,
  findLastAssistantTurnActionsListIndex,
  isMessageInActiveStreamingTurn,
  messageShowsAssistantTurnActions,
} from '../../src/lib/message-turn-actions-ui.ts';

test('messageShowsAssistantTurnActions only allows the last assistant body in a turn', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: 'First answer.', pending: false },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'glob', phase: 'succeeded', headline: 'Matched', detailLines: [] },
    },
    { id: 4, role: 'assistant', content: 'Second answer.', pending: false },
  ];

  assert.equal(messageShowsAssistantTurnActions(messages[1], messages, 1), false);
  assert.equal(messageShowsAssistantTurnActions(messages[3], messages, 3), true);
  assert.equal(findLastAssistantBodyTextIndexInTurn(messages, 1), 3);
  assert.equal(findLastAssistantTurnActionsListIndex(messages), 3);
});

test('messageShowsAssistantTurnActions hides body when tools still follow in turn', () => {
  const messages = [
    { id: 1, role: 'user', content: 'go', pending: false },
    { id: 2, role: 'assistant', content: 'Let me explore the repo.', pending: false },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'list_dir', phase: 'succeeded', headline: 'Listed', detailLines: [] },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'next step' },
    },
  ];

  assert.equal(messageShowsAssistantTurnActions(messages[1], messages, 1), false);
  assert.equal(findLastAssistantTurnActionsListIndex(messages), null);
});

test('isMessageInActiveStreamingTurn scopes busy suppression to the active turn only', () => {
  const messages = [
    { id: 1, role: 'user', content: 'first', pending: false },
    { id: 2, role: 'assistant', content: 'Done from turn one.', pending: false },
    { id: 3, role: 'user', content: 'second', pending: false },
    { id: 4, role: 'assistant', content: 'Streaming...', pending: true },
  ];

  assert.equal(isMessageInActiveStreamingTurn(messages, 1, true), false);
  assert.equal(isMessageInActiveStreamingTurn(messages, 3, true), true);
  assert.equal(isMessageInActiveStreamingTurn(messages, 3, false), false);
});

test('messageShowsAssistantTurnActions ignores thinking-only rows', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'plan' },
    },
    { id: 3, role: 'assistant', content: 'Final answer.', pending: false },
  ];

  assert.equal(messageShowsAssistantTurnActions(messages[1], messages, 1), false);
  assert.equal(messageShowsAssistantTurnActions(messages[2], messages, 2), true);
});
