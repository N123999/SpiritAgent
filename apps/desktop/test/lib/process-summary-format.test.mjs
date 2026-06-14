import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyProcessToolCounts } from '../../src/lib/process-tool-category.ts';
import {
  PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES,
  formatProcessGroupSummary,
} from '../../src/lib/process-summary-format.ts';

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
  if (key === 'process.compacted' && options?.count === 1) {
    return '1 Compacted';
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
