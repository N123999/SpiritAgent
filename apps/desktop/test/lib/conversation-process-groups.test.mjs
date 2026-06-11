import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationRenderItems,
  isMessageHiddenByProcessGroup,
  isProcessEligibleMetaMessage,
} from '../../src/lib/conversation-process-groups.ts';
import { emptyProcessToolCounts } from '../../src/lib/process-tool-category.ts';

const scopeKey = 'main';

test('isProcessEligibleMetaMessage accepts tools and standalone thinking', () => {
  assert.equal(
    isProcessEligibleMetaMessage({
      id: 1,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] },
    }),
    true,
  );
  assert.equal(
    isProcessEligibleMetaMessage({
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'plan' },
    }),
    true,
  );
  assert.equal(
    isProcessEligibleMetaMessage({
      id: 3,
      role: 'assistant',
      content: 'answer',
      pending: false,
    }),
    false,
  );
  assert.equal(
    isProcessEligibleMetaMessage({
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'finish_task', phase: 'succeeded', headline: 'x', detailLines: [] },
    }),
    false,
  );
});

test('buildConversationRenderItems keeps unsealed meta rows exposed at turn end', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'plan' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: true,
      tool: { toolName: 'read_file', phase: 'running', headline: 'Viewing', detailLines: [] },
    },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'message', 'message'],
  );
});

test('buildConversationRenderItems seals meta run before assistant body text', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'plan' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'edit_file', phase: 'succeeded', headline: 'Edited', detailLines: [] },
    },
    { id: 5, role: 'assistant', content: 'Here is the answer.', pending: false },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'process-group', 'message'],
  );
  const group = items[1];
  assert.equal(group.kind, 'process-group');
  if (group.kind !== 'process-group') {
    return;
  }
  assert.deepEqual(group.messageIndices, [1, 2, 3]);
  assert.equal(group.sealed, true);
  assert.equal(group.toolCounts.view, 1);
  assert.equal(group.toolCounts.edit, 1);
  assert.equal(isMessageHiddenByProcessGroup(items, 2), true);
  assert.equal(isMessageHiddenByProcessGroup(items, 5), false);
});

test('buildConversationRenderItems supports body then tools then body in one turn', () => {
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
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { compaction: 'compressed context' },
    },
    { id: 5, role: 'assistant', content: 'Second answer.', pending: false },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'message', 'process-group', 'message'],
  );
  const group = items[2];
  assert.equal(group.kind, 'process-group');
  if (group.kind !== 'process-group') {
    return;
  }
  assert.deepEqual(group.messageIndices, [2, 3]);
  assert.deepEqual(group.toolCounts, { ...emptyProcessToolCounts(), view: 1 });
});

test('buildConversationRenderItems uses scope key in group id', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'grep', phase: 'succeeded', headline: 'Search', detailLines: [] },
    },
    { id: 3, role: 'assistant', content: 'done', pending: false },
  ];
  const mainItems = buildConversationRenderItems(messages, 'main');
  const subagentItems = buildConversationRenderItems(messages, 'subagent:abc');
  const mainGroup = mainItems[1];
  const subagentGroup = subagentItems[1];
  assert.equal(mainGroup.kind, 'process-group');
  assert.equal(subagentGroup.kind, 'process-group');
  if (mainGroup.kind !== 'process-group' || subagentGroup.kind !== 'process-group') {
    return;
  }
  assert.equal(mainGroup.groupId, 'main:process:1');
  assert.notEqual(mainGroup.groupId, subagentGroup.groupId);
});

test('buildConversationRenderItems keeps sealed thinking-only rows as messages', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, aux: { thinking: 'plan' } },
    { id: 3, role: 'assistant', content: 'First answer.', pending: false },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] },
    },
    { id: 5, role: 'assistant', content: 'Second answer.', pending: false },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'message', 'message', 'process-group', 'message'],
  );
  assert.equal(isMessageHiddenByProcessGroup(items, 1), false);
  const group = items[3];
  assert.equal(group.kind, 'process-group');
  if (group.kind !== 'process-group') {
    return;
  }
  assert.deepEqual(group.messageIndices, [3]);
});

test('buildConversationRenderItems assigns unique group ids within one turn', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, aux: { thinking: 'plan' } },
    { id: 3, role: 'assistant', content: 'First.', pending: false },
    { id: 4, role: 'assistant', content: '', pending: false, tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] } },
    { id: 5, role: 'assistant', content: '', pending: false, aux: { thinking: 'more' } },
    { id: 6, role: 'assistant', content: 'Second.', pending: false },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  const groups = items.filter((item) => item.kind === 'process-group');
  assert.equal(groups.length, 1);
  if (groups[0]?.kind !== 'process-group') {
    return;
  }
  assert.equal(groups[0].groupId, 'main:process:3');
  assert.deepEqual(groups[0].messageIndices, [3, 4]);
});

test('buildConversationRenderItems merges post-body thinking into the next tool process group', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, aux: { thinking: 'open' } },
    { id: 3, role: 'assistant', content: 'Body one.', pending: false },
    { id: 4, role: 'assistant', content: '', pending: false, aux: { thinking: 'a' } },
    { id: 5, role: 'assistant', content: '', pending: false, aux: { thinking: 'b' } },
    {
      id: 6,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'read_file', phase: 'succeeded', headline: 'Viewed', detailLines: [] },
    },
    { id: 7, role: 'assistant', content: 'Body two.', pending: false },
  ];
  const items = buildConversationRenderItems(messages, scopeKey);
  assert.deepEqual(
    items.map((item) => item.kind),
    ['message', 'message', 'message', 'process-group', 'message'],
  );
  assert.equal(isMessageHiddenByProcessGroup(items, 3), true);
  assert.equal(isMessageHiddenByProcessGroup(items, 4), true);
  const group = items[3];
  assert.equal(group.kind, 'process-group');
  if (group.kind !== 'process-group') {
    return;
  }
  assert.deepEqual(group.messageIndices, [3, 4, 5]);
});
