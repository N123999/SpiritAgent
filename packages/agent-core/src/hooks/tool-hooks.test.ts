import assert from 'node:assert/strict';
import test from 'node:test';

import {
  postHookToolInputFromPreGate,
  resolveApprovalGateAfterAuthorize,
  runPreToolUseGate,
} from './tool-hooks.js';
import { HookDeniedError } from './errors.js';
import type { HookRunner } from './types.js';

test('resolveApprovalGateAfterAuthorize skips host approval when hook allow bypasses', () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: 'ready', request: { name: 'grep' }, hookBypassApproval: true },
    { kind: 'need-approval', prompt: 'approve grep?' },
  );
  assert.equal(gate, null);
});

test('resolveApprovalGateAfterAuthorize keeps host approval without hook bypass', () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: 'ready', request: { name: 'grep' } },
    { kind: 'need-approval', prompt: 'approve grep?' },
  );
  assert.deepEqual(gate, { prompt: 'approve grep?', trustTarget: undefined });
});

test('resolveApprovalGateAfterAuthorize prefers hook ask prompt', () => {
  const gate = resolveApprovalGateAfterAuthorize(
    { kind: 'needs-approval', request: { name: 'grep' }, prompt: 'hook says ask' },
    { kind: 'allowed' },
  );
  assert.deepEqual(gate, { prompt: 'hook says ask', trustTarget: undefined });
});

test('runPreToolUseGate maps hook ask to needs-approval', async () => {
  const runner: HookRunner = {
    runSessionStart: async () => { throw new Error('unused'); },
    runSessionEnd: async () => { throw new Error('unused'); },
    runSubmitPrompt: async () => { throw new Error('unused'); },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: 'ask',
      userMessage: 'confirm grep',
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => { throw new Error('unused'); },
    runSubagentStart: async () => { throw new Error('unused'); },
    runSubagentEnd: async () => { throw new Error('unused'); },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: 's1',
          conversationPath: null,
          workspaceRoot: '/w',
          model: 'm',
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: 'grep' }),
        },
      },
    } as never,
    { id: 'tc1', name: 'grep', argumentsJson: '{"pattern":"hook"}' },
    { name: 'grep' },
  );

  assert.equal(gate.kind, 'needs-approval');
  if (gate.kind === 'needs-approval') {
    assert.equal(gate.prompt, 'confirm grep');
  }
});

test('runPreToolUseGate maps hook allow to bypass approval', async () => {
  const runner: HookRunner = {
    runSessionStart: async () => { throw new Error('unused'); },
    runSessionEnd: async () => { throw new Error('unused'); },
    runSubmitPrompt: async () => { throw new Error('unused'); },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: 'allow',
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => { throw new Error('unused'); },
    runSubagentStart: async () => { throw new Error('unused'); },
    runSubagentEnd: async () => { throw new Error('unused'); },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: 's1',
          conversationPath: null,
          workspaceRoot: '/w',
          model: 'm',
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: 'shell' }),
        },
      },
    } as never,
    { id: 'tc1', name: 'shell', argumentsJson: '{"command":"echo hi"}' },
    { name: 'shell' },
  );

  assert.equal(gate.kind, 'ready');
  if (gate.kind === 'ready') {
    assert.equal(gate.hookBypassApproval, true);
  }
});

test('runPreToolUseGate maps hook deny to denied', async () => {
  const runner: HookRunner = {
    runSessionStart: async () => { throw new Error('unused'); },
    runSessionEnd: async () => { throw new Error('unused'); },
    runSubmitPrompt: async () => { throw new Error('unused'); },
    runPreToolUse: async () => ({
      records: [],
      denied: true,
      permission: 'deny',
      userMessage: 'blocked',
      agentMessage: undefined,
      updatedInput: undefined,
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => { throw new Error('unused'); },
    runSubagentStart: async () => { throw new Error('unused'); },
    runSubagentEnd: async () => { throw new Error('unused'); },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: 's1',
          conversationPath: null,
          workspaceRoot: '/w',
          model: 'm',
        },
        toolExecutor: {
          requestFromFunctionCall: async () => ({ name: 'grep' }),
        },
      },
    } as never,
    { id: 'tc1', name: 'grep', argumentsJson: '{}' },
    { name: 'grep' },
  );

  assert.equal(gate.kind, 'denied');
  if (gate.kind === 'denied') {
    assert.ok(gate.error instanceof HookDeniedError);
  }
});

test('runPreToolUseGate preserves effectiveToolInput from hook updatedInput', async () => {
  const runner: HookRunner = {
    runSessionStart: async () => { throw new Error('unused'); },
    runSessionEnd: async () => { throw new Error('unused'); },
    runSubmitPrompt: async () => { throw new Error('unused'); },
    runPreToolUse: async () => ({
      records: [],
      denied: false,
      permission: undefined,
      userMessage: undefined,
      agentMessage: undefined,
      updatedInput: { path: 'rewritten.md' },
      additionalContexts: [],
      followupMessage: undefined,
    }),
    runPostToolUse: async () => { throw new Error('unused'); },
    runSubagentStart: async () => { throw new Error('unused'); },
    runSubagentEnd: async () => { throw new Error('unused'); },
  };

  const gate = await runPreToolUseGate(
    {
      options: {
        hookRunner: runner,
        hookSessionContext: {
          sessionId: 's1',
          conversationPath: null,
          workspaceRoot: '/w',
          model: 'm',
        },
        toolExecutor: {
          requestFromFunctionCall: async (_name: string, argumentsJson: string) => ({
            name: 'read_file',
            ...(JSON.parse(argumentsJson) as Record<string, unknown>),
          }),
        },
      },
    } as never,
    { id: 'tc1', name: 'read_file', argumentsJson: '{"path":"original.md"}' },
    { name: 'read_file', path: 'original.md' },
  );

  assert.equal(gate.kind, 'ready');
  if (gate.kind === 'ready') {
    assert.deepEqual(gate.effectiveToolInput, { path: 'rewritten.md' });
    assert.equal((gate.request as { path?: string }).path, 'rewritten.md');
  }
});

test('postHookToolInputFromPreGate prefers effectiveToolInput', () => {
  const toolInput = postHookToolInputFromPreGate(
    {
      kind: 'ready',
      request: { name: 'grep' },
      effectiveToolInput: { pattern: 'hooked' },
    },
    '{"pattern":"original"}',
  );
  assert.deepEqual(toolInput, { pattern: 'hooked' });
});
