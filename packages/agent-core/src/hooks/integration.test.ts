import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendHookAdditionalContexts,
  runSessionEndHook,
  runSessionStartHookAndApply,
  runSubmitPromptHook,
} from './integration.js';
import type { HookRunner, HookRunResult } from './types.js';

function mockResult(overrides: Partial<HookRunResult> = {}): HookRunResult {
  return {
    records: [],
    denied: false,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
    ...overrides,
  };
}

function createRecordingRunner(): {
  runner: HookRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const runner: HookRunner = {
    runSessionStart: async (input) => {
      calls.push(`sessionStart:${input.source}`);
      return mockResult({ additionalContexts: ['start-context'] });
    },
    runSessionEnd: async (input) => {
      calls.push(`sessionEnd:${input.reason}`);
      return mockResult();
    },
    runSubmitPrompt: async (input) => {
      calls.push(`submitPrompt:${input.prompt}`);
      return mockResult();
    },
    runPreToolUse: async (input) => {
      calls.push(`preToolUse:${input.toolName}`);
      return mockResult();
    },
    runPostToolUse: async (input) => {
      calls.push(`postToolUse:${input.toolName}`);
      return mockResult({ additionalContexts: ['post-context'] });
    },
    runSubagentStart: async (input) => {
      calls.push(`subagentStart:${input.subagentType}`);
      return mockResult();
    },
    runSubagentEnd: async (input) => {
      calls.push(`subagentEnd:${input.status}`);
      return mockResult({ followupMessage: 'follow-up' });
    },
  };
  return { runner, calls };
}

test('runSessionStartHookAndApply records additionalContext', async () => {
  const { runner } = createRecordingRunner();
  const contexts: string[] = [];
  await runSessionStartHookAndApply(
    runner,
    (_role, content) => {
      contexts.push(content);
    },
    {
      sessionId: 's1',
      conversationPath: '/tmp/chat.json',
      workspaceRoot: '/workspace',
      model: 'test-model',
    },
    'startup',
  );
  assert.deepEqual(contexts, ['start-context']);
});

test('runSessionEndHook invokes runner', async () => {
  const { runner, calls } = createRecordingRunner();
  await runSessionEndHook(
    runner,
    {
      sessionId: 's1',
      conversationPath: null,
      workspaceRoot: '/workspace',
      model: 'test-model',
    },
    'close',
  );
  assert.deepEqual(calls, ['sessionEnd:close']);
});

test('appendHookAdditionalContexts skips empty values', () => {
  const contexts: string[] = [];
  appendHookAdditionalContexts((_role, content) => {
    contexts.push(content);
  }, ['  alpha  ', '', 'beta']);
  assert.deepEqual(contexts, ['alpha', 'beta']);
});

test('runSubmitPromptHook forwards prompt to runner', async () => {
  const { runner, calls } = createRecordingRunner();
  await runSubmitPromptHook(
    {
      hookRunner: runner,
      hookSessionContext: {
        sessionId: 's1',
        conversationPath: null,
        workspaceRoot: '/workspace',
        model: 'm',
      },
    } as never,
    'hello hooks',
    '42',
  );
  assert.deepEqual(calls, ['submitPrompt:hello hooks']);
});

test('recording runner covers all seven hook events', async () => {
  const { runner, calls } = createRecordingRunner();
  await runner.runSessionStart({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    source: 'open',
  });
  await runner.runSessionEnd({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    reason: 'switch',
  });
  await runner.runSubmitPrompt({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    prompt: 'p',
    messageId: undefined,
  });
  await runner.runPreToolUse({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    toolName: 'grep',
    toolCallId: 'tc1',
    toolInput: { pattern: 'hook' },
  });
  await runner.runPostToolUse({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    toolName: 'grep',
    toolCallId: 'tc1',
    toolInput: { pattern: 'hook' },
    toolOutput: 'ok',
    durationMs: 1,
    failed: false,
  });
  await runner.runSubagentStart({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    subagentSessionId: 'child',
    subagentType: 'explore',
    task: 'find hooks',
  });
  await runner.runSubagentEnd({
    sessionId: 's1',
    conversationPath: null,
    workspaceRoot: '/w',
    model: 'm',
    subagentSessionId: 'child',
    subagentType: 'explore',
    status: 'completed',
    task: 'find hooks',
    summary: 'done',
    modifiedFiles: undefined,
  });

  assert.deepEqual(calls, [
    'sessionStart:open',
    'sessionEnd:switch',
    'submitPrompt:p',
    'preToolUse:grep',
    'postToolUse:grep',
    'subagentStart:explore',
    'subagentEnd:completed',
  ]);
});
