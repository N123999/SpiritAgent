import assert from 'node:assert/strict';
import test from 'node:test';

import { assistantToolCallMessageFromState } from '../tool-agent.js';
import { createTurnContext } from './helpers.js';
import { processToolCalls, type TurnMachineRuntime } from './turn-machine.js';

test('processToolCalls persists the full assistant tool-call message from state', async () => {
  const state = {
    messages: [{
      role: 'assistant',
      content: 'calling weather',
      reasoning_parts: [{
        type: 'reasoning',
        text: 'Need weather first.',
        providerOptions: {
          anthropic: {
            signature: 'sig_turn_machine',
          },
        },
      }],
      tool_calls: [{
        id: 'call_weather',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Paris"}',
        },
      }],
    }],
    steps: 1,
  };
  const calls = [{
    id: 'call_weather',
    name: 'get_weather',
    argumentsJson: '{"city":"Paris"}',
  }];

  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({ kind: 'failure', error: 'unused', requestTrace: [] }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) => ({ argumentsJson }),
        authorize: async () => ({ kind: 'need-approval', prompt: 'approve?' }),
        execute: async () => ({ content: [], summaryText: '' }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      assistantToolCallMessageFromState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error('unused');
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error('unused');
    },
    startHistoryCompactionAsync: () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { argumentsJson: string }>;

  const result = await processToolCalls(runtime, state, 'weather?', calls, createTurnContext());

  assert.equal(result.kind, 'requires-approval');
  assert.equal(runtime.historyStore.length, 1);
  assert.deepEqual(runtime.historyStore[0], {
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'calling weather',
    }],
    toolCalls: [{
      id: 'call_weather',
      name: 'get_weather',
      argumentsJson: '{"city":"Paris"}',
    }],
    providerState: {
      reasoning_parts: [{
        type: 'reasoning',
        text: 'Need weather first.',
        providerOptions: {
          anthropic: {
            signature: 'sig_turn_machine',
          },
        },
      }],
    },
  });
});