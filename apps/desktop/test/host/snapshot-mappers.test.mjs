import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapPendingToolApproval } from '../../dist-electron/src/host/snapshot-mappers.js';

test('mapPendingToolApproval forwards subagentSessionId when present', () => {
  const mapped = mapPendingToolApproval({
    toolName: 'shell',
    request: { command: 'git status' },
    prompt: 'Run git status?',
    trustTarget: 'shell:git status',
    subagentSessionId: 'subagent-123',
  });

  assert.equal(mapped.subagentSessionId, 'subagent-123');
  assert.equal(mapped.toolName, 'shell');
});

test('mapPendingToolApproval omits blank subagentSessionId', () => {
  const mapped = mapPendingToolApproval({
    toolName: 'read_file',
    request: { path: 'README.md' },
    prompt: 'Read README.md?',
    subagentSessionId: '   ',
  });

  assert.equal(mapped.subagentSessionId, undefined);
});
