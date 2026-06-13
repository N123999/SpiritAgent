import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePullRequestBodyTaskListProgress } from './pull-request-body-task-list.js';

test('parsePullRequestBodyTaskListProgress returns null when body is empty', () => {
  assert.equal(parsePullRequestBodyTaskListProgress(null), null);
  assert.equal(parsePullRequestBodyTaskListProgress(''), null);
  assert.equal(parsePullRequestBodyTaskListProgress('No tasks here'), null);
});

test('parsePullRequestBodyTaskListProgress counts checkboxes across entire body', () => {
  const body = [
    '## Summary',
    '- [ ] item in summary',
    '',
    '## Test plan',
    '- [x] done test',
    '- [ ] pending test',
    '',
    '## Checklist',
    '  - [X] nested done',
  ].join('\n');

  assert.deepEqual(parsePullRequestBodyTaskListProgress(body), {
    total: 4,
    completed: 2,
  });
});

test('parsePullRequestBodyTaskListProgress handles all unchecked', () => {
  const body = '## Test plan\n- [ ] one\n- [ ] two';
  assert.deepEqual(parsePullRequestBodyTaskListProgress(body), {
    total: 2,
    completed: 0,
  });
});

test('parsePullRequestBodyTaskListProgress handles all completed', () => {
  const body = '- [x] one\n- [X] two';
  assert.deepEqual(parsePullRequestBodyTaskListProgress(body), {
    total: 2,
    completed: 2,
  });
});
