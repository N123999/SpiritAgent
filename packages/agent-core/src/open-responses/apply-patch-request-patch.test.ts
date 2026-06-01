import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonObject } from '../ports.js';
import {
  buildApplyPatchToolCallArgumentsJson,
  patchResponsesRequestBodyForApplyPatch,
  registerPendingApplyPatchCallIds,
} from './apply-patch-bridge.js';
import { APPLY_PATCH_HOST_TOOL_NAME } from './apply-patch-eligibility.js';

const openAiConfig = {
  transportKind: 'open-responses' as const,
  apiKey: 'test',
  model: 'gpt-5.1',
  llmVendor: 'openai' as const,
  responsesProvider: 'openai' as const,
};

const gatewayConfig = {
  transportKind: 'open-responses' as const,
  apiKey: 'test',
  model: 'openai/gpt-5.4-mini',
  llmVendor: 'vercel-ai-gateway' as const,
  responsesProvider: 'open-responses-compatible' as const,
};

test('patchResponsesRequestBodyForApplyPatch openai uses native apply_patch_call items', () => {
  const callId = 'call_test_1';
  const operation = { type: 'update_file', path: 'README.md', diff: '+x\n' };
  registerPendingApplyPatchCallIds([callId]);

  const body = {
    input: [
      {
        type: 'function_call',
        call_id: callId,
        name: APPLY_PATCH_HOST_TOOL_NAME,
        arguments: buildApplyPatchToolCallArgumentsJson(callId, operation),
      },
      {
        type: 'function_call_output',
        call_id: callId,
        output: 'ok',
      },
    ],
  } as JsonObject;

  patchResponsesRequestBodyForApplyPatch(body, openAiConfig);

  const input = body.input as JsonObject[];
  assert.equal(input[0]?.type, 'apply_patch_call');
  assert.equal(input[1]?.type, 'apply_patch_call_output');
});

test('patchResponsesRequestBodyForApplyPatch gateway keeps function_call pairs with callId in arguments', () => {
  const callId = 'call_test_2';
  const operation = { type: 'update_file', path: 'README.md', diff: '+x\n' };
  registerPendingApplyPatchCallIds([callId]);

  const body = {
    input: [
      {
        type: 'function_call',
        call_id: callId,
        name: APPLY_PATCH_HOST_TOOL_NAME,
        arguments: JSON.stringify({ operation }),
      },
      {
        type: 'function_call_output',
        call_id: callId,
        output: 'ok',
      },
    ],
  } as JsonObject;

  patchResponsesRequestBodyForApplyPatch(body, gatewayConfig);

  const input = body.input as JsonObject[];
  assert.equal(input[0]?.type, 'function_call');
  assert.equal(input[0]?.name, APPLY_PATCH_HOST_TOOL_NAME);
  const args = JSON.parse(String(input[0]?.arguments)) as { callId?: string; operation?: unknown };
  assert.equal(args.callId, callId);
  assert.equal(input[1]?.type, 'function_call_output');
  assert.equal(
    input.some((item) => item.type === 'apply_patch_call'),
    false,
  );
});
