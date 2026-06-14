import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldTightenAfterPreviousMetaMessage,
  shouldTightenAfterPreviousRenderItem,
  shouldUseDefaultSpacingAfterAbortedThought,
} from '../../src/lib/message-card-spacing.ts';

test('shouldTightenAfterPreviousRenderItem tightens body text after process group', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] },
    },
    { id: 3, role: 'assistant', content: 'Answer', pending: false },
  ];
  const previousItem = {
    kind: 'process-group',
    groupId: 'main:process:2',
    messageIndices: [1],
    toolCounts: {
      explore: 1,
      view: 0,
      create: 0,
      edit: 0,
      delete: 0,
      ask: 0,
      diagnose: 0,
      generate: 0,
      run: 0,
      other: 0,
    },
  };
  assert.equal(
    shouldTightenAfterPreviousRenderItem(previousItem, messages[2], messages),
    true,
  );
});

test('shouldUseDefaultSpacingAfterAbortedThought keeps list rhythm for continue streaming row', () => {
  const messages = [
    { id: 1, role: 'user', content: 'nih', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Interrupted reasoning.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Continued reasoning.' },
    },
  ];

  assert.equal(shouldUseDefaultSpacingAfterAbortedThought(messages[1], messages[2], messages, 2), true);
  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[1], messages[2], messages, 2), false);

  const currentWithBody = {
    ...messages[2],
    content: 'Hello',
  };
  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[1], currentWithBody, messages, 2), false);
});

test('shouldTightenAfterPreviousMetaMessage keeps meta tighten for tool-turn Thought→Thinking', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'running', headline: 'read', detailLines: [] },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Planning which lines to read.' },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Reading the rest of the file now.' },
    },
  ];

  assert.equal(shouldUseDefaultSpacingAfterAbortedThought(messages[2], messages[3], messages, 3), false);
  assert.equal(shouldTightenAfterPreviousMetaMessage(messages[2], messages[3], messages, 3), true);
});
