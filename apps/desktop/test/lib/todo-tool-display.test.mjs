import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeTodoWriteDelta,
  formatTodoWriteDeltaDetail,
  parseTodoItemsFromPayload,
  resolveTodoWriteBeforeSnapshot,
  todoWriteSummaryDetail,
} from '../../dist-electron/src/lib/todo-tool-display.js';

const t = (key, options = {}) => {
  const count = options.count ?? 0;
  switch (key) {
    case 'tool.todoWriteAdded':
      return `+${count}`;
    case 'tool.todoWriteCompleted':
      return `✓${count}`;
    case 'tool.todoWriteRemoved':
      return `-${count}`;
    default:
      return key;
  }
};

test('parseTodoItemsFromPayload ignores ids and timestamps', () => {
  assert.deepEqual(
    parseTodoItemsFromPayload({
      todos: [{ id: 'abc', title: ' Task ', status: 'pending', createdAtUnixMs: 1 }],
    }),
    [{ title: 'Task', status: 'pending' }],
  );
});

test('parseTodoItemsFromPayload returns undefined for incomplete streaming json', () => {
  assert.equal(parseTodoItemsFromPayload('{"todos":[{"title":"任务 01","status":"completed"'), undefined);
  assert.equal(parseTodoItemsFromPayload(''), undefined);
  assert.equal(parseTodoItemsFromPayload('not-json'), undefined);
});

test('parseTodoItemsFromPayload treats explicit empty todos as clear', () => {
  assert.deepEqual(parseTodoItemsFromPayload({ todos: [] }), []);
  assert.deepEqual(parseTodoItemsFromPayload('{"todos":[]}'), []);
});

test('computeTodoWriteDelta counts added completed and removed', () => {
  assert.deepEqual(
    computeTodoWriteDelta(
      [{ title: 'A', status: 'pending' }, { title: 'B', status: 'pending' }],
      [{ title: 'A', status: 'completed' }, { title: 'C', status: 'pending' }],
    ),
    { added: 1, completed: 1, removed: 1 },
  );
});

test('computeTodoWriteDelta treats clear-all as removed only', () => {
  assert.deepEqual(
    computeTodoWriteDelta(
      [{ title: 'A', status: 'pending' }, { title: 'B', status: 'completed' }],
      [],
    ),
    { added: 0, completed: 0, removed: 2 },
  );
});

test('formatTodoWriteDeltaDetail joins non-zero parts', () => {
  assert.equal(
    formatTodoWriteDeltaDetail({ added: 2, completed: 1, removed: 0 }, t, ' / '),
    '+2 / ✓1',
  );
  assert.equal(formatTodoWriteDeltaDetail({ added: 0, completed: 0, removed: 0 }, t, ' / '), undefined);
});

test('todoWriteSummaryDetail returns undefined when only reordering', () => {
  assert.equal(
    todoWriteSummaryDetail({
      before: [{ title: 'A', status: 'pending' }],
      afterPayload: { todos: [{ title: 'A', status: 'pending' }] },
      t,
      separator: ' / ',
    }),
    undefined,
  );
});

test('todoWriteSummaryDetail returns undefined when after payload is unreliable', () => {
  assert.equal(
    todoWriteSummaryDetail({
      before: [
        { title: '任务 01', status: 'pending' },
        { title: '任务 02', status: 'pending' },
      ],
      afterPayload: '{"todos":[{"title":"任务 01","status":"completed"',
      t,
      separator: ' / ',
    }),
    undefined,
  );
});

test('todoWriteSummaryDetail counts completed items when after payload is reliable', () => {
  assert.equal(
    todoWriteSummaryDetail({
      before: [
        { title: '任务 01', status: 'pending' },
        { title: '任务 02', status: 'pending' },
      ],
      afterPayload: {
        todos: [
          { title: '任务 01', status: 'completed' },
          { title: '任务 02', status: 'completed' },
        ],
      },
      t,
      separator: ' / ',
    }),
    '✓2',
  );
});

test('parseTodoItemsFromPayload preserves in_progress status', () => {
  assert.deepEqual(
    parseTodoItemsFromPayload({
      todos: [
        { title: 'A', status: 'pending' },
        { title: 'B', status: 'in_progress' },
        { title: 'C', status: 'completed' },
      ],
    }),
    [
      { title: 'A', status: 'pending' },
      { title: 'B', status: 'in_progress' },
      { title: 'C', status: 'completed' },
    ],
  );
});

test('computeTodoWriteDelta counts in_progress to completed as completed', () => {
  assert.deepEqual(
    computeTodoWriteDelta(
      [{ title: 'A', status: 'in_progress' }],
      [{ title: 'A', status: 'completed' }],
    ),
    { added: 0, completed: 1, removed: 0 },
  );
});

test('resolveTodoWriteBeforeSnapshot prefers existing non-empty snapshot', () => {
  assert.deepEqual(
    resolveTodoWriteBeforeSnapshot(
      [{ title: 'Old', status: 'pending' }],
      [{ title: 'Live', status: 'completed' }],
    ),
    [{ title: 'Old', status: 'pending' }],
  );
  assert.deepEqual(
    resolveTodoWriteBeforeSnapshot(undefined, [{ title: 'Live', status: 'pending' }]),
    [{ title: 'Live', status: 'pending' }],
  );
});
