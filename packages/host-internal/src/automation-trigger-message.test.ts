import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATION_TRIGGER_CLOSE,
  AUTOMATION_TRIGGER_OPEN,
  buildAutomationTriggerMessage,
  formatGitHubAutomationEventLabel,
} from './automation-trigger-message.js';

test('buildAutomationTriggerMessage wraps GitHub event with meta block', () => {
  const message = buildAutomationTriggerMessage({
    overview: 'Summarize the PR.',
    trigger: {
      kind: 'github',
      owner: 'o',
      repo: 'r',
      event: 'pull_request_created',
    },
    context: {
      kind: 'github',
      event: 'pull_request_created',
      eventUrl: 'https://github.com/o/r/pull/12',
    },
  });
  assert.match(message, new RegExp(`^${AUTOMATION_TRIGGER_OPEN}`));
  assert.match(message, /Event: Pull request created \(https:\/\/github\.com\/o\/r\/pull\/12\)\./);
  assert.match(message, new RegExp(`${AUTOMATION_TRIGGER_CLOSE}\\n\\nSummarize the PR\\.$`));
});

test('buildAutomationTriggerMessage wraps scheduled time trigger', () => {
  const message = buildAutomationTriggerMessage({
    overview: 'Daily digest',
    trigger: { kind: 'time', schedule: { kind: 'daily', hour: 20, minute: 0 } },
    context: { kind: 'time' },
  });
  assert.match(message, /Event: Scheduled run \(daily 20:00\)\./);
  assert.match(message, /Daily digest$/);
});

test('formatGitHubAutomationEventLabel covers issue events', () => {
  assert.equal(formatGitHubAutomationEventLabel('issue_created'), 'Issue created');
});
