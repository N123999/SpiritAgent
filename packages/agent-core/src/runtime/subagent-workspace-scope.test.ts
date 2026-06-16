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

test('scopeAgentRuntimeOptionsForSubagentWorkspace replaces appendUserLlmMessage callback', () => {
  const options = baseOptions({
    appendUserLlmMessage: (state) => state,
  });

  const scoped = scopeAgentRuntimeOptionsForSubagentWorkspace(
    options,
    'D:\\repo.worktrees\\spirit-a',
  );
  assert.notEqual(scoped.appendUserLlmMessage, options.appendUserLlmMessage);
  assert.equal(typeof scoped.appendUserLlmMessage, 'function');
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
