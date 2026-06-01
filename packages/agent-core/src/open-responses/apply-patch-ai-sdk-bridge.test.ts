import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonObject } from '../ports.js';
import { openAiMessagesToResponsesAiSdkMessages } from './ai-sdk-message-bridge.js';
import {
  buildApplyPatchToolCallArgumentsJson,
  normalizeApplyPatchToolCallArgumentsJson,
  patchResponsesRequestBodyForApplyPatch,
  prepareApplyPatchRequestBodyStash,
} from './apply-patch-bridge.js';

test('normalizeApplyPatchToolCallArgumentsJson injects callId for AI SDK', () => {
  const callId = 'call_apply_1';
  const operation = { type: 'update_file', path: 'README.md', diff: '+x\n' };
  const raw = JSON.stringify({ operation });
  const normalized = normalizeApplyPatchToolCallArgumentsJson(callId, raw);
  const parsed = JSON.parse(normalized) as { callId?: string; operation?: unknown };
  assert.equal(parsed.callId, callId);
  assert.deepEqual(parsed.operation, operation);
});

test('openAiMessagesToResponsesAiSdkMessages omits apply_patch from SDK tool parts', () => {
  const callId = 'call_apply_1';
  const operation = { type: 'update_file', path: 'README.md', diff: '+x\n' };
  const messages = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: callId,
        type: 'function',
        function: {
          name: 'apply_patch',
          arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
        },
      }],
    },
    {
      role: 'tool',
      tool_call_id: callId,
      content: 'ok',
    },
  ];

  const sdkMessages = openAiMessagesToResponsesAiSdkMessages(messages);
  assert.equal(
    sdkMessages.some((message) => {
      const content = message.content;
      return Array.isArray(content)
        && content.some((part) => (part as { type?: string }).type === 'tool-call');
    }),
    false,
  );
  assert.equal(sdkMessages.some((message) => message.role === 'tool'), false);

  const body = { input: [] } as JsonObject;
  patchResponsesRequestBodyForApplyPatch(body, {
    transportKind: 'open-responses',
    apiKey: 'test',
    model: 'openai/gpt-5.4-mini',
    llmVendor: 'vercel-ai-gateway',
    responsesProvider: 'open-responses-compatible',
  });
  const input = body.input as JsonObject[];
  assert.equal(input.length, 2);
  assert.equal(input[0]?.type, 'function_call');
  assert.equal(input[1]?.type, 'function_call_output');
});

test('prepareApplyPatchRequestBodyStash pairs assistant call with tool result', () => {
  const callId = 'call_apply_2';
  const operation = { type: 'create_file', path: 'demo.txt', diff: '+hi\n' };
  prepareApplyPatchRequestBodyStash([
    {
      role: 'assistant',
      tool_calls: [{
        id: callId,
        type: 'function',
        function: {
          name: 'apply_patch',
          arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
        },
      }],
    },
    { role: 'tool', tool_call_id: callId, content: 'created' },
  ]);

  const body = { input: [] } as JsonObject;
  patchResponsesRequestBodyForApplyPatch(body, {
    transportKind: 'open-responses',
    apiKey: 'test',
    model: 'openai/gpt-5.4-mini',
    llmVendor: 'vercel-ai-gateway',
    responsesProvider: 'open-responses-compatible',
  });
  const input = body.input as JsonObject[];
  assert.equal(input[0]?.type, 'function_call');
  assert.equal(input[0]?.call_id, callId);
  assert.equal(input[1]?.type, 'function_call_output');
});
