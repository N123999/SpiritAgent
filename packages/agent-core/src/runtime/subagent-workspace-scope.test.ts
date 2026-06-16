import assert from 'node:assert/strict';
import test from 'node:test';

import { scopeAgentRuntimeOptionsForSubagentWorkspace } from './subagent-workspace-scope.js';
import type { AgentRuntimeOptions, PendingWorkspaceFile } from './types.js';

type TestState = { messages: unknown[]; steps: number };

function baseOptions(
  overrides: Partial<AgentRuntimeOptions<undefined, TestState, unknown>> = {},
): AgentRuntimeOptions<undefined, TestState, unknown> {
  return {
    config: undefined,
    llmTransport: {} as AgentRuntimeOptions<undefined, TestState, unknown>['llmTransport'],
    toolExecutor: {} as AgentRuntimeOptions<undefined, TestState, unknown>['toolExecutor'],
    createToolAgentState: () => ({ messages: [], steps: 0 }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    ...overrides,
  };
}

test('scopeAgentRuntimeOptionsForSubagentWorkspace rebinds appendUserLlmMessage workspace root', () => {
  let parentCalled = false;
  const options = baseOptions({
    appendUserLlmMessage: () => {
      parentCalled = true;
      return { messages: [], steps: 0 };
    },
  });

  const scoped = scopeAgentRuntimeOptionsForSubagentWorkspace(
    options,
    'D:\\repo.worktrees\\spirit-a',
  );
  scoped.appendUserLlmMessage?.(
    { messages: [], steps: 0 },
    { role: 'user', content: 'hi' },
  );
  assert.equal(parentCalled, false);
});

test('scopeAgentRuntimeOptionsForSubagentWorkspace uses resolveWorkspaceFilesForRoot when provided', async () => {
  const sampleFile: PendingWorkspaceFile = {
    kind: 'text',
    path: 'scoped/README.md',
    totalChars: 4,
    truncated: false,
    attachedAtUnixMs: 1,
    content: 'body',
  };
  const options = baseOptions({
    resolveWorkspaceFilesForRoot: (workspaceRoot, userInput) => [
      { ...sampleFile, path: `${workspaceRoot}/${userInput}` },
    ],
    resolveWorkspaceFilesFromInput: () => [{ ...sampleFile, path: 'parent/wrong' }],
  });

  const scoped = scopeAgentRuntimeOptionsForSubagentWorkspace(
    options,
    'D:\\repo.worktrees\\spirit-a',
  );
  const files = await scoped.resolveWorkspaceFilesFromInput?.('README.md');
  assert.deepEqual(files, [{ ...sampleFile, path: 'D:\\repo.worktrees\\spirit-a/README.md' }]);
});
