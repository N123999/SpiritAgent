import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantTurnMessageIndices,
  canCopyAssistantTurn,
  formatAssistantMessageCopySegments,
  formatAssistantTurnCopyText,
} from '../../src/lib/message-turn-copy.ts';
import { formatToolCallSummaryPlainText } from '../../src/lib/tool-call-display.ts';
import i18n from '../../src/lib/i18n.ts';

test('assistantTurnMessageIndices stops at the next user message', () => {
  const messages = [
    { id: 1, role: 'user', content: 'first', pending: false },
    { id: 2, role: 'assistant', content: 'a1', pending: false },
    { id: 3, role: 'user', content: 'second', pending: false },
    { id: 4, role: 'assistant', content: 'a2', pending: false },
  ];

  assert.deepEqual(assistantTurnMessageIndices(messages, 1), [1]);
  assert.deepEqual(assistantTurnMessageIndices(messages, 3), [3]);
});

test('formatAssistantTurnCopyText preserves body and tool order without thinking', () => {
  const messages = [
    { id: 1, role: 'user', content: 'go', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Need to inspect the file.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolName: 'read_file',
        phase: 'succeeded',
        headline: '读取',
        headlineDetail: 'foo.txt',
        detailLines: [],
      },
    },
    { id: 4, role: 'assistant', content: 'Here is the summary.', pending: false },
  ];

  assert.equal(
    formatAssistantTurnCopyText(messages, 3),
    ['读取 foo.txt', 'Here is the summary.'].join('\n\n'),
  );
});

test('formatAssistantMessageCopySegments omits thinking text', () => {
  assert.deepEqual(
    formatAssistantMessageCopySegments({
      id: 1,
      role: 'assistant',
      content: 'Answer.',
      pending: false,
      aux: { thinking: 'Internal reasoning.' },
    }),
    ['Answer.'],
  );
});

test('formatToolCallSummaryPlainText: read_file uses headline and detail', () => {
  assert.equal(
    formatToolCallSummaryPlainText({
      toolName: 'read_file',
      phase: 'succeeded',
      headline: '读取',
      headlineDetail: 'foo.txt',
      detailLines: [],
    }),
    '读取 foo.txt',
  );
});

test('formatToolCallSummaryPlainText: run_shell_command with reason and command', () => {
  assert.deepEqual(
    formatToolCallSummaryPlainText({
      toolName: 'run_shell_command',
      phase: 'running',
      headline: '执行并发命令',
      headlineDetail: 'echo abc',
      detailLines: [],
    }),
    '运行 执行并发命令 echo abc',
  );
});

test('formatToolCallSummaryPlainText: failed tools append settings.failed suffix', () => {
  assert.equal(
    formatToolCallSummaryPlainText({
      toolName: 'grep',
      phase: 'failed',
      headline: '搜索',
      headlineDetail: 'TODO',
      detailLines: [],
    }),
    `搜索 TODO ${i18n.t('settings.failed')}`,
  );
});

test('canCopyAssistantTurn is false for thinking-only assistant rows', () => {
  const messages = [
    { id: 1, role: 'user', content: 'go', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Still reasoning about the task.' },
    },
  ];

  assert.equal(canCopyAssistantTurn(messages, 1), false);
  assert.equal(formatAssistantMessageCopySegments(messages[1]).length, 0);
});

test('formatAssistantTurnCopyText includes finishTaskNotice', () => {
  const messages = [
    { id: 1, role: 'user', content: 'go', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: 'Done.',
      pending: false,
      aux: { finishTaskNotice: 'Task marked complete.' },
    },
  ];

  assert.equal(
    formatAssistantTurnCopyText(messages, 1),
    ['Done.', 'Task marked complete.'].join('\n\n'),
  );
});
