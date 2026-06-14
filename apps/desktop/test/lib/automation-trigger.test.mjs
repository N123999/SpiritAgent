import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatDesktopAutomationTriggerLabel,
  isValidDesktopAutomationTrigger,
} from '../../src/lib/automation-trigger.ts';

const labels = {
  hourly: 'Hourly',
  dailyPrefix: 'Daily',
  weeklyPrefix: 'Weekly',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  formatWeekly: (weekday, time) => `Weekly ${weekday} ${time}`,
  githubPrefix: 'GitHub',
  githubPullRequestCreated: 'PR created',
  githubIssueCreated: 'Issue created',
};

test('formatDesktopAutomationTriggerLabel renders github trigger', () => {
  assert.equal(
    formatDesktopAutomationTriggerLabel(
      {
        kind: 'github',
        owner: 'acme',
        repo: 'app',
        event: 'pull_request_created',
      },
      labels,
    ),
    'GitHub · acme/app · PR created',
  );
});

test('isValidDesktopAutomationTrigger requires github owner and repo', () => {
  assert.equal(isValidDesktopAutomationTrigger({ kind: 'time', schedule: { kind: 'hourly' } }), true);
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: 'github',
      owner: 'acme',
      repo: 'app',
      event: 'issue_created',
    }),
    true,
  );
  assert.equal(
    isValidDesktopAutomationTrigger({
      kind: 'github',
      owner: '',
      repo: 'app',
      event: 'issue_created',
    }),
    false,
  );
});
