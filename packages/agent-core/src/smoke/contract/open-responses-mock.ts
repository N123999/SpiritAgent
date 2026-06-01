import type { JsonObject } from '../../ports.js';

function openResponsesUsage(): JsonObject {
  return {
    input_tokens: 1,
    output_tokens: 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
}

export function buildOpenResponsesApplyPatchCallBody(model: string): JsonObject {
  return {
    id: 'resp-apply-patch',
    object: 'response',
    created_at: 0,
    model,
    status: 'completed',
    usage: openResponsesUsage(),
    output: [
      {
        type: 'apply_patch_call',
        id: 'apc_1',
        call_id: 'call_apply_patch_1',
        status: 'completed',
        operation: {
          type: 'create_file',
          path: 'demo.txt',
          diff: '+hello apply patch\n',
        },
      },
    ],
  };
}

export function buildOpenResponsesToolCallBody(model: string): JsonObject {
  return {
    id: 'resp-tool-call',
    object: 'response',
    created_at: 0,
    model,
    status: 'completed',
    usage: openResponsesUsage(),
    output: [
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_open_responses_1',
        name: 'demo_lookup',
        arguments: '{"query":"Spirit Agent migration"}',
        status: 'completed',
      },
    ],
  };
}

export function buildOpenResponsesFinalTextBody(model: string, text: string): JsonObject {
  return {
    id: 'resp-final',
    object: 'response',
    created_at: 0,
    model,
    status: 'completed',
    usage: openResponsesUsage(),
    output: [
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text,
          },
        ],
      },
    ],
  };
}
