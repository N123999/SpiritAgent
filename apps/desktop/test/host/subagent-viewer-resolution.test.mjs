import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveSubagentViewerMessages } from '../../dist-electron/src/host/subagent-viewer.js';
import { WORKTREE_BOOTSTRAP_TOOL_NAME } from '../../dist-electron/src/host/worktree-bootstrap-card.js';

test('resolveSubagentViewerMessages keeps projected process rows when history has final body', () => {
  const projected = [
    { id: 1, role: 'user', content: 'Say stop', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolName: WORKTREE_BOOTSTRAP_TOOL_NAME,
        phase: 'succeeded',
        headline: 'Created Worktree',
        detailLines: [],
      },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Need to return stop only.' },
    },
  ];
  const history = [
    { id: 1, role: 'user', content: 'Say stop', pending: false },
    { id: 4, role: 'assistant', content: 'stop', pending: false },
  ];

  const resolved = resolveSubagentViewerMessages({
    projected,
    historyMessages: history,
    isLiveSession: false,
    finalOutput: 'stop',
  });

  assert.equal(resolved.source, 'projected-enriched-with-history-body');
  assert.equal(resolved.messages.length, 4);
  assert.equal(
    resolved.messages[1]?.tool?.toolName,
    WORKTREE_BOOTSTRAP_TOOL_NAME,
  );
  assert.equal(resolved.messages[2]?.aux?.thinking, 'Need to return stop only.');
  assert.equal(resolved.messages[3]?.content, 'stop');
});

test('resolveSubagentViewerMessages still prefers history when projected has no extra process metadata', () => {
  const projected = [
    { id: 1, role: 'user', content: 'Say stop', pending: false },
    { id: 2, role: 'assistant', content: 'st', pending: false },
  ];
  const history = [
    { id: 1, role: 'user', content: 'Say stop', pending: false },
    { id: 3, role: 'assistant', content: 'stop', pending: false },
  ];

  const resolved = resolveSubagentViewerMessages({
    projected,
    historyMessages: history,
    isLiveSession: false,
    finalOutput: 'stop',
  });

  assert.equal(resolved.source, 'history-longer-completed');
  assert.equal(resolved.messages.length, 2);
  assert.equal(resolved.messages[1]?.content, 'stop');
});
