import assert from 'node:assert/strict';
import test from 'node:test';

import { SubmitPromptHookDeniedError } from '../hooks/errors.js';
import type { HookRunner, HookRunResult } from '../hooks/types.js';
import { prepareSubmittedUserTurn } from './context.js';

function mockResult(overrides: Partial<HookRunResult> = {}): HookRunResult {
  return {
    records: [],
    denied: false,
    permission: undefined,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
    ...overrides,
  };
}

test('prepareSubmittedUserTurn throws SubmitPromptHookDeniedError when hook denies', async () => {
  const hookRunner: HookRunner = {
    runSessionStart: async () => mockResult(),
    runSessionEnd: async () => mockResult(),
    runSubmitPrompt: async () => mockResult({
      denied: true,
      userMessage: 'blocked prompt',
      followupMessage: 'try later',
    }),
    runPreToolUse: async () => mockResult(),
    runPostToolUse: async () => mockResult(),
    runSubagentStart: async () => mockResult(),
    runSubagentEnd: async () => mockResult(),
  };

  const runtime = {
    options: {
      hookRunner,
      hookSessionContext: {
        sessionId: 's1',
        conversationPath: null,
        workspaceRoot: '/w',
        model: 'm',
      },
      createToolAgentState: (messages: unknown[], userInput: string) => ({ messages, userInput }),
    },
    historyStore: [] as Array<{ role: string; content: unknown }>,
    pendingUserTurnStore: undefined as string | undefined,
    takePendingImages: () => [] as string[],
    takePendingMcpResources: () => [],
    recordContextMessage: () => {},
  };

  await assert.rejects(
    () => prepareSubmittedUserTurn(runtime as never, 'hello', []),
    (error: unknown) => {
      assert.ok(error instanceof SubmitPromptHookDeniedError);
      assert.equal(error.denialMessage, 'blocked prompt');
      assert.equal(error.followupMessage, 'try later');
      return true;
    },
  );
});
