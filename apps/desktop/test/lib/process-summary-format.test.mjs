import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateProcessToolCounts,
  emptyProcessToolCounts,
} from '../../src/lib/process-tool-category.ts';
import {
  PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES,
  formatProcessGroupSummary,
} from '../../src/lib/process-summary-format.ts';
import i18n from '../../src/lib/i18n.ts';

const t = (key, options) => {
  if (key === 'process.explored' && options?.count === 2) {
    return '2 Explored';
  }
  if (key === 'process.thought' && options?.count === 1) {
    return '1 Thought';
  }
  if (key === 'process.thought' && options?.count === 4) {
    return '4 Thoughts';
  }
  if (key === 'process.separator') {
    return ', ';
  }
  return key;
};

test('PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES is three', () => {
  assert.equal(PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES, 3);
});

test('formatProcessGroupSummary prefers tool counts over aux rows', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, aux: { thinking: 'plan' } },
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
      tool: { toolName: 'grep', phase: 'succeeded', headline: 'Search', detailLines: [] },
    },
  ];
  const summary = formatProcessGroupSummary(
    t,
    { ...emptyProcessToolCounts(), explore: 2 },
    messages,
    [1, 2, 3],
  );
  assert.equal(summary, '2 Explored');
});

test('formatProcessGroupSummary falls back to thought count when no tools', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    { id: 2, role: 'assistant', content: '', pending: false, aux: { thinking: 'a' } },
    { id: 3, role: 'assistant', content: '', pending: false, aux: { thinking: 'b' } },
    { id: 4, role: 'assistant', content: '', pending: false, aux: { thinking: 'c' } },
    { id: 5, role: 'assistant', content: '', pending: false, aux: { thinking: 'd' } },
  ];
  assert.equal(
    formatProcessGroupSummary(t, emptyProcessToolCounts(), messages, [1]),
    '1 Thought',
  );
  assert.equal(
    formatProcessGroupSummary(t, emptyProcessToolCounts(), messages, [1, 2, 3, 4]),
    '4 Thoughts',
  );
});

test('formatProcessGroupSummary orders categories by tool chronology', async () => {
  await i18n.changeLanguage('zh-CN');
  const tZh = i18n.t.bind(i18n);

  const askThenCreateMessages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'ask_questions', phase: 'succeeded', headline: '询问', detailLines: [] },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'create_file', phase: 'succeeded', headline: '创建', detailLines: [] },
    },
  ];
  const askThenCreateTools = askThenCreateMessages
    .map((message) => message.tool)
    .filter(Boolean);
  assert.equal(
    formatProcessGroupSummary(
      tZh,
      aggregateProcessToolCounts(askThenCreateTools),
      askThenCreateMessages,
      [1, 2],
    ),
    '1 次询问，1 次创建',
  );

  const createThenAskMessages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'create_file', phase: 'succeeded', headline: '创建', detailLines: [] },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'ask_questions', phase: 'succeeded', headline: '询问', detailLines: [] },
    },
  ];
  const createThenAskTools = createThenAskMessages
    .map((message) => message.tool)
    .filter(Boolean);
  assert.equal(
    formatProcessGroupSummary(
      tZh,
      aggregateProcessToolCounts(createThenAskTools),
      createThenAskMessages,
      [1, 2],
    ),
    '1 次创建，1 次询问',
  );

  const repeatedAskMessages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'ask_questions', phase: 'succeeded', headline: '询问', detailLines: [] },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'ask_questions', phase: 'succeeded', headline: '询问', detailLines: [] },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      tool: { toolName: 'create_file', phase: 'succeeded', headline: '创建', detailLines: [] },
    },
  ];
  const repeatedAskTools = repeatedAskMessages
    .map((message) => message.tool)
    .filter(Boolean);
  assert.equal(
    formatProcessGroupSummary(
      tZh,
      aggregateProcessToolCounts(repeatedAskTools),
      repeatedAskMessages,
      [1, 2, 3],
    ),
    '2 次询问，1 次创建',
  );
});
