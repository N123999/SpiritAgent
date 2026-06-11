import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldTightenAfterPreviousRenderItem } from '../../src/lib/message-card-spacing.ts';

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
    sealed: true,
    toolCounts: {
      view: 1,
      create: 0,
      edit: 0,
      delete: 0,
      ask: 0,
      diagnose: 0,
      generate: 0,
      other: 0,
    },
  };
  assert.equal(
    shouldTightenAfterPreviousRenderItem(previousItem, messages[2], messages),
    true,
  );
});
