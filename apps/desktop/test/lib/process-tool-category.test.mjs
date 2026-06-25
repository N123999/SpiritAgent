import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateProcessToolCounts,
  classifyProcessToolCategory,
  emptyProcessToolCounts,
} from '../../src/lib/process-tool-category.ts';
import { formatProcessSummary } from '../../src/lib/process-summary-format.ts';
import i18n from '../../src/lib/i18n.ts';

test('classifyProcessToolCategory maps known tools', () => {
  assert.equal(classifyProcessToolCategory('read_file'), 'explore');
  assert.equal(classifyProcessToolCategory('grep'), 'explore');
  assert.equal(classifyProcessToolCategory('glob'), 'explore');
  assert.equal(classifyProcessToolCategory('list_directory_files'), 'explore');
  assert.equal(classifyProcessToolCategory('web_fetch'), 'explore');
  assert.equal(classifyProcessToolCategory('web_search'), 'explore');
  assert.equal(classifyProcessToolCategory('code_interpreter'), 'other');
  assert.equal(classifyProcessToolCategory('dream_read'), 'explore');
  assert.equal(classifyProcessToolCategory('dream_list'), 'explore');
  assert.equal(classifyProcessToolCategory('todo_list'), 'explore');
  assert.equal(classifyProcessToolCategory('create_file'), 'create');
  assert.equal(classifyProcessToolCategory('edit_file'), 'edit');
  assert.equal(classifyProcessToolCategory('delete_file'), 'delete');
  assert.equal(classifyProcessToolCategory('ask_questions'), 'ask');
  assert.equal(classifyProcessToolCategory('get_diagnostics'), 'diagnose');
  assert.equal(classifyProcessToolCategory('generate_image'), 'generate');
  assert.equal(classifyProcessToolCategory('shell'), 'run');
});

test('classifyProcessToolCategory: apply_patch uses headline verb', () => {
  assert.equal(classifyProcessToolCategory('apply_patch', 'Created'), 'create');
  assert.equal(classifyProcessToolCategory('apply_patch', 'Edited'), 'edit');
  assert.equal(classifyProcessToolCategory('apply_patch', '删除'), 'delete');
});

test('aggregateProcessToolCounts counts each tool once', () => {
  const counts = aggregateProcessToolCounts([
    { toolName: 'read_file', headline: 'Viewed' },
    { toolName: 'glob', headline: 'Matched' },
    { toolName: 'edit_file', headline: 'Edited' },
  ]);
  assert.deepEqual(counts, {
    ...emptyProcessToolCounts(),
    explore: 2,
    edit: 1,
  });
});

test('formatProcessSummary: zh-CN joins up to three categories and truncates', async () => {
  await i18n.changeLanguage('zh-CN');
  const summary = formatProcessSummary(i18n.t.bind(i18n), {
    ...emptyProcessToolCounts(),
    explore: 2,
    create: 1,
    edit: 3,
    delete: 1,
    ask: 1,
  });
  assert.equal(summary, '2 次探索，1 次创建，3 次编辑，及更多');
});

test('formatProcessSummary: en uses plural labels', async () => {
  await i18n.changeLanguage('en');
  const summary = formatProcessSummary(i18n.t.bind(i18n), {
    ...emptyProcessToolCounts(),
    explore: 2,
    create: 1,
    edit: 2,
  });
  assert.equal(summary, '2 Explored, 1 Created, 2 Edited');
});

test('formatProcessSummary: empty counts returns empty string', () => {
  assert.equal(formatProcessSummary(i18n.t.bind(i18n), emptyProcessToolCounts()), '');
});

test('formatProcessSummary: shell uses ran label', async () => {
  await i18n.changeLanguage('zh-CN');
  assert.equal(
    formatProcessSummary(i18n.t.bind(i18n), { ...emptyProcessToolCounts(), run: 1 }),
    '1 次运行',
  );
  await i18n.changeLanguage('en');
  assert.equal(
    formatProcessSummary(i18n.t.bind(i18n), { ...emptyProcessToolCounts(), run: 2 }),
    '2 Ran',
  );
});

test('formatProcessSummary: read_file uses read label in English', async () => {
  await i18n.changeLanguage('zh-CN');
  assert.equal(
    formatProcessSummary(i18n.t.bind(i18n), { ...emptyProcessToolCounts(), explore: 1 }),
    '1 次探索',
  );
  await i18n.changeLanguage('en');
  assert.equal(
    formatProcessSummary(i18n.t.bind(i18n), { ...emptyProcessToolCounts(), explore: 2 }),
    '2 Explored',
  );
});
